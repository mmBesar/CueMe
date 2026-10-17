//! WebSocket session handling.

use crate::{Envelope, Shared, To};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use cue_core::markdown;
use cue_core::protocol::{ClientMsg, Cmd, Role, ServerMsg, PROTOCOL};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;

#[derive(Deserialize)]
pub struct Q {
    pin: Option<String>,
}

pub fn announce_library(sh: &Shared) {
    if let Ok(files) = sh.lib.list() {
        let j = serde_json::to_string(&ServerMsg::Library { files }).unwrap();
        sh.send(0, To::All, false, j);
    }
}

pub async fn handler(
    ws: WebSocketUpgrade,
    State(sh): State<Arc<Shared>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<Q>,
) -> Response {
    let hdr = |n: &str| headers.get(n).and_then(|v| v.to_str().ok());
    if !Shared::origin_ok(hdr("origin"), hdr("host")) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    let ip = addr.ip();
    if sh.locked_out(ip) {
        return (StatusCode::TOO_MANY_REQUESTS, "too many attempts").into_response();
    }
    if !sh.pin_ok(q.pin.as_deref().unwrap_or("")) {
        sh.record_fail(ip);
        return (StatusCode::UNAUTHORIZED, "bad pin").into_response();
    }
    ws.max_message_size(4 * 1024 * 1024)
        .on_upgrade(move |s| session(s, sh))
}

fn finite01(p: f64) -> f64 {
    if p.is_finite() {
        p.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

async fn session(socket: WebSocket, sh: Arc<Shared>) {
    let id = sh.next_id.fetch_add(1, Ordering::SeqCst);
    let (mut sink, mut stream) = socket.split();
    let mut rx = sh.tx.subscribe();
    let mut role = Role::Remote;
    sh.peers.lock().unwrap().insert(id, role);
    // liveness + flood control
    let mut ping = tokio::time::interval(std::time::Duration::from_secs(15));
    let mut last_heard = std::time::Instant::now();
    let mut win_start = std::time::Instant::now();
    let mut win_count = 0u32;

    // initial burst
    let welcome = serde_json::to_string(&ServerMsg::Welcome {
        protocol: PROTOCOL,
        version: crate::VERSION.to_string(),
        id,
    })
    .unwrap();
    let mut first = vec![welcome, sh.state_json(), sh.peers_json()];
    if let Ok(files) = sh.lib.list() {
        first.push(serde_json::to_string(&ServerMsg::Library { files }).unwrap());
    }
    if let Some((p, playing)) = *sh.last_pos.lock().unwrap() {
        first.push(
            serde_json::to_string(&ServerMsg::Pos {
                p,
                playing,
                eta: None,
            })
            .unwrap(),
        );
    }
    for m in first {
        if sink.send(Message::Text(m.into())).await.is_err() {
            sh.peers.lock().unwrap().remove(&id);
            return;
        }
    }
    sh.send(0, To::All, false, sh.peers_json());

    loop {
        tokio::select! {
            incoming = stream.next() => {
                let Some(Ok(msg)) = incoming else { break };
                last_heard = std::time::Instant::now();
                // at most ~300 messages per second per connection (a held slider sends about 40)
                if win_start.elapsed() >= std::time::Duration::from_secs(1) { win_start = std::time::Instant::now(); win_count = 0; }
                win_count += 1;
                if win_count > 300 { continue; }
                let text = match msg {
                    Message::Text(t) => t,
                    Message::Close(_) => break,
                    _ => continue,
                };
                let parsed: ClientMsg = match serde_json::from_str(text.as_str()) {
                    Ok(m) => m,
                    Err(_) => {
                        let e = serde_json::to_string(&ServerMsg::Error { msg: "bad message".into() }).unwrap();
                        if sink.send(Message::Text(e.into())).await.is_err() { break; }
                        continue;
                    }
                };
                match parsed {
                    ClientMsg::Hello { role: r } => {
                        role = r;
                        sh.peers.lock().unwrap().insert(id, role);
                        sh.send(0, To::All, false, sh.peers_json());
                    }
                    ClientMsg::Set { settings } => {
                        {
                            let mut s = sh.session.lock().unwrap();
                            s.settings = s.settings.merged(&settings);
                        }
                        sh.broadcast_state();
                    }
                    ClientMsg::Text { text, name } => {
                        if text.len() <= cue_core::library::MAX_BYTES {
                            sh.set_text(text, name).await;
                        } else {
                            let e = serde_json::to_string(&ServerMsg::Error { msg: "text too large".into() }).unwrap();
                            let _ = sink.send(Message::Text(e.into())).await;
                        }
                    }
                    ClientMsg::Load { name } => match sh.lib.read(&name) {
                        Ok(t) => sh.set_text(t, Some(name)).await,
                        Err(e) => {
                            let e = serde_json::to_string(&ServerMsg::Error { msg: e.to_string() }).unwrap();
                            let _ = sink.send(Message::Text(e.into())).await;
                        }
                    },
                    ClientMsg::Save { name, text } => match sh.lib.write(&name, &text) {
                        Ok(n) => {
                            let n = crate::clean_name(&n);
                            announce_library(&sh);
                            let mut changed = false;
                            {
                                let mut s = sh.session.lock().unwrap();
                                if s.name != n { s.name = n; changed = true; }
                            }
                            if changed { sh.broadcast_state(); }
                        }
                        Err(e) => {
                            let e = serde_json::to_string(&ServerMsg::Error { msg: e.to_string() }).unwrap();
                            let _ = sink.send(Message::Text(e.into())).await;
                        }
                    },
                    ClientMsg::Render { text } => {
                        if text.len() <= cue_core::library::MAX_BYTES {
                            let html = tokio::task::spawn_blocking(move || markdown::render(&text)).await.unwrap_or_default();
                            let j = serde_json::to_string(&ServerMsg::Rendered { html }).unwrap();
                            if sink.send(Message::Text(j.into())).await.is_err() { break; }
                        }
                    }
                    ClientMsg::Cmd(c) => {
                        let c = match c {
                            Cmd::Seek { p } => Cmd::Seek { p: finite01(p) },
                            Cmd::Jog { v } => Cmd::Jog { v: if v.is_finite() { v.clamp(-1.0, 1.0) } else { 0.0 } },
                            Cmd::Heading { dir } => Cmd::Heading { dir: dir.signum() },
                            other => other,
                        };
                        let j = serde_json::to_string(&ServerMsg::Cmd(c)).unwrap();
                        sh.send(id, To::Displays, true, j);
                    }
                    ClientMsg::Pos { p, playing, eta } => {
                        if role == Role::Display {
                            let p = finite01(p);
                            let eta = eta.filter(|e| e.is_finite() && *e >= 0.0);
                            *sh.last_pos.lock().unwrap() = Some((p, playing));
                            let j = serde_json::to_string(&ServerMsg::Pos { p, playing, eta }).unwrap();
                            sh.send(id, To::All, true, j);
                        }
                    }
                    ClientMsg::Playing { playing } => {
                        if role == Role::Display {
                            let p = sh.last_pos.lock().unwrap().map(|x| x.0).unwrap_or(0.0);
                            *sh.last_pos.lock().unwrap() = Some((p, playing));
                            let j = serde_json::to_string(&ServerMsg::Pos { p, playing, eta: None }).unwrap();
                            sh.send(id, To::All, true, j);
                        }
                    }
                }
            }
            _ = ping.tick() => {
                if last_heard.elapsed() > std::time::Duration::from_secs(50) { break; } // half-open connection
                if sink.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
                // browsers hide protocol pings from scripts, so also send one the page can see
                if sink.send(Message::Text(r#"{"t":"ping"}"#.into())).await.is_err() { break; }
            }
            outgoing = rx.recv() => {
                match outgoing {
                    Ok(Envelope { from, to, skip_sender, json }) => {
                        if skip_sender && from == id { continue; }
                        let ok = match to {
                            To::All => true,
                            To::Displays => role == Role::Display,
                                        };
                        if ok && sink.send(Message::Text(json.to_string().into())).await.is_err() { break; }
                    }
                    Err(RecvError::Lagged(_)) => {
                        // we dropped messages: resync with a full state
                        if sink.send(Message::Text(sh.state_json().into())).await.is_err() { break; }
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        }
    }
    let no_display_left = {
        let mut p = sh.peers.lock().unwrap();
        p.remove(&id);
        !p.values().any(|r| *r == Role::Display)
    };
    if no_display_left {
        // nobody is scrolling any more: do not leave remotes showing "playing"
        let stopped = {
            let mut lp = sh.last_pos.lock().unwrap();
            match *lp {
                Some((p, true)) => {
                    *lp = Some((p, false));
                    Some(p)
                }
                _ => None,
            }
        };
        if let Some(p) = stopped {
            let j = serde_json::to_string(&ServerMsg::Pos {
                p,
                playing: false,
                eta: None,
            })
            .unwrap();
            sh.send(0, To::All, false, j);
        }
    }
    sh.send(0, To::All, false, sh.peers_json());
}
