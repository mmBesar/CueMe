//! LAN discovery with plain UDP broadcast.
//!
//! Every hub shouts "I'm here: name + port" on the local network every 2
//! seconds and listens for the same from others. It needs no special
//! permissions or system libraries, so it works the same on Linux, Android 6 and
//! Android 16 (mDNS did not: Android 6 has no API for it). If broadcast is
//! blocked on a network (some guest Wi-Fi), the QR code / typed address still work.

use crate::Shared;
use serde::Serialize;
use socket2::{Domain, Protocol, Socket, Type};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::task::JoinHandle;

/// UDP port every CueMe listens on for announcements.
pub const DEFAULT_PORT: u16 = 7879;
const ANNOUNCE_EVERY: Duration = Duration::from_secs(2);
const FORGET_AFTER: Duration = Duration::from_secs(12);
const MAX_PEERS: usize = 64;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Peer {
    pub name: String,
    pub addrs: Vec<String>,
    pub port: u16,
}

/// The CueMe hubs heard recently.
#[derive(Clone, Default)]
pub struct Found(Arc<Mutex<HashMap<u64, (Peer, Instant)>>>);

impl Found {
    pub fn list(&self) -> Vec<Peer> {
        let mut m = self.0.lock().unwrap();
        m.retain(|_, (_, t)| t.elapsed() < FORGET_AFTER);
        let mut v: Vec<Peer> = m.values().map(|(p, _)| p.clone()).collect();
        v.sort_by(|a, b| a.name.cmp(&b.name).then(a.port.cmp(&b.port)));
        v
    }

    fn seen(&self, id: u64, name: String, ip: String, port: u16) {
        let mut m = self.0.lock().unwrap();
        m.retain(|_, (_, t)| t.elapsed() < FORGET_AFTER); // expired entries must not hold the slots
        if m.len() >= MAX_PEERS && !m.contains_key(&id) {
            return;
        }
        m.insert(
            id,
            (
                Peer {
                    name,
                    addrs: vec![ip],
                    port,
                },
                Instant::now(),
            ),
        );
    }
}

pub fn encode(id: u64, port: u16, name: &str) -> String {
    let mut clean = String::new();
    for c in name
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if c == '|' { '-' } else { c })
    {
        if clean.len() + c.len_utf8() > 100 {
            break; // stay under the 120-byte limit parse() accepts, even for Arabic/CJK names
        }
        clean.push(c);
    }
    format!("CUEME1|{id:016x}|{port}|{clean}")
}

pub fn parse(s: &str) -> Option<(u64, u16, String)> {
    let mut it = s.splitn(4, '|');
    if it.next()? != "CUEME1" {
        return None;
    }
    let id = u64::from_str_radix(it.next()?, 16).ok()?;
    let port: u16 = it.next()?.parse().ok()?;
    if port == 0 {
        return None;
    }
    let name: String = it.next()?.chars().filter(|c| !c.is_control()).collect();
    if name.len() > 120 {
        return None;
    }
    Some((id, port, name))
}

fn bind(port: u16) -> std::io::Result<UdpSocket> {
    let s = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    // Several CueMe programs on one computer may share the port.
    s.set_reuse_address(true)?;
    #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
    s.set_reuse_port(true)?;
    s.set_broadcast(true)?;
    s.set_nonblocking(true)?;
    s.bind(&SocketAddr::from(([0, 0, 0, 0], port)).into())?;
    UdpSocket::from_std(s.into())
}

/// Start announcing and listening. Returns the tasks (abort them to stop).
/// Failure to open the socket is not fatal: discovery is just off.
pub fn start(sh: &Arc<Shared>, port: u16, targets: Vec<SocketAddr>) -> Vec<JoinHandle<()>> {
    let sock = match bind(port) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            eprintln!("cueme: LAN discovery off ({e})");
            return Vec::new();
        }
    };
    let id = sh.id;
    let hello = encode(id, sh.port, &sh.name);

    let tx_sock = sock.clone();
    let announcer = tokio::spawn(async move {
        loop {
            for t in &targets {
                let _ = tx_sock.send_to(hello.as_bytes(), t).await;
            }
            tokio::time::sleep(ANNOUNCE_EVERY).await;
        }
    });

    let found = sh.found.clone();
    let listener = tokio::spawn(async move {
        let mut buf = [0u8; 512];
        loop {
            let Ok((n, from)) = sock.recv_from(&mut buf).await else {
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            };
            let Ok(text) = std::str::from_utf8(&buf[..n]) else {
                continue;
            };
            if let Some((pid, pport, name)) = parse(text) {
                if pid != id {
                    found.seen(pid, name, from.ip().to_string(), pport);
                }
            }
        }
    });
    vec![announcer, listener]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let s = encode(0xdead_beef, 7878, "Mohammed's | phone");
        assert_eq!(
            parse(&s),
            Some((0xdead_beef, 7878, "Mohammed's - phone".to_string()))
        );
    }

    #[test]
    fn rejects_garbage() {
        for bad in [
            "",
            "hello",
            "CUEME1|zz|7878|x",
            "CUEME1|01|0|x",
            "CUEME2|01|1|x",
            "CUEME1|01|99999|x",
            "CUEME1|01|80",
        ] {
            assert!(parse(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn forgets_old_and_caps() {
        let f = Found::default();
        for i in 0..100u64 {
            f.seen(i, format!("n{i}"), "10.0.0.1".into(), 7878);
        }
        assert_eq!(f.list().len(), MAX_PEERS);
    }
}
