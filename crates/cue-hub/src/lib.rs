//! cue-hub: the CueMe session hub.
//!
//! One hub = one prompter session. It keeps the script + settings, relays
//! remote commands to the display and the display's live position to every
//! remote, serves the web UI and the script library, and announces itself on
//! the LAN (UDP broadcast, see `beacon`). The desktop/Android apps embed it; `cueme-serve` runs it
//! headless.

mod beacon;
mod http;
mod ws;

use cue_core::auth;
use cue_core::library::Library;
use cue_core::markdown;
use cue_core::protocol::Role;
use cue_core::settings::Settings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, oneshot};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Things only the app around the hub can do (the hub itself is just a server).
pub trait Native: Send + Sync {
    /// Toggle the app window's fullscreen. Returns the new state.
    fn toggle_fullscreen(&self) -> bool;
}

#[derive(Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub library_dir: PathBuf,
    /// `None` = load the saved PIN, or create one.
    pub pin: Option<String>,
    /// Announce this hub on the LAN and listen for others.
    pub discovery: bool,
    /// UDP port for discovery (0 = off).
    pub beacon_port: u16,
    /// Where to send announcements. `None` = LAN broadcast. (Tests use this.)
    pub beacon_targets: Option<Vec<SocketAddr>>,
    pub name: String,
    /// Window control provided by the app (desktop app); `None` in browsers/headless.
    pub native: Option<Arc<dyn Native>>,
}

impl Config {
    pub fn with_data_dir(data_dir: impl Into<PathBuf>) -> Config {
        let data_dir = data_dir.into();
        Config {
            bind: "0.0.0.0:7878".parse().unwrap(),
            library_dir: data_dir.join("scripts"),
            data_dir,
            pin: None,
            discovery: true,
            beacon_port: beacon::DEFAULT_PORT,
            beacon_targets: None,
            name: default_name(),
            native: None,
        }
    }
}

fn default_name() -> String {
    // GUI-launched programs usually do not inherit $HOSTNAME, so also ask the system.
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok()
        .or_else(|| std::fs::read_to_string("/proc/sys/kernel/hostname").ok())
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "CueMe".to_string())
}

/// A script name from a peer: bounded, no control characters.
pub(crate) fn clean_name(n: &str) -> String {
    n.chars().filter(|c| !c.is_control()).take(120).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum To {
    All,
    Displays,
}

#[derive(Debug, Clone)]
pub(crate) struct Envelope {
    pub from: u64,
    pub to: To,
    /// If true the sender does not receive its own message.
    pub skip_sender: bool,
    pub json: Arc<str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Session {
    pub settings: Settings,
    pub text: String,
    pub name: String,
}

pub(crate) struct Shared {
    /// Random per run: lets a hub ignore its own announcements.
    pub id: u64,
    pub pin: String,
    pub name: String,
    pub port: u16,
    pub session: Mutex<Session>,
    pub html: Mutex<String>,
    pub rev: AtomicU64,
    pub lib: Library,
    pub tx: broadcast::Sender<Envelope>,
    pub next_id: AtomicU64,
    pub peers: Mutex<HashMap<u64, Role>>,
    pub last_pos: Mutex<Option<(f64, bool)>>,
    pub fails: Mutex<HashMap<IpAddr, (u32, Instant)>>,
    pub dirty: AtomicBool,
    pub data_dir: PathBuf,
    pub library_dir: PathBuf,
    pub found: beacon::Found,
    pub native: Option<Arc<dyn Native>>,
}

impl Shared {
    /// Count a failed PIN attempt; returns true if this IP is locked out.
    pub fn locked_out(&self, ip: IpAddr) -> bool {
        let mut f = self.fails.lock().unwrap();
        match f.get(&ip) {
            Some((n, t)) if t.elapsed() < Duration::from_secs(60) => *n >= 10,
            Some(_) => {
                f.remove(&ip);
                false
            }
            None => false,
        }
    }

    pub fn record_fail(&self, ip: IpAddr) {
        let mut f = self.fails.lock().unwrap();
        let e = f.entry(ip).or_insert((0, Instant::now()));
        if e.1.elapsed() >= Duration::from_secs(60) {
            *e = (0, Instant::now());
        }
        e.0 += 1;
    }

    pub fn pin_ok(&self, given: &str) -> bool {
        auth::pin_matches(&self.pin, given)
    }

    pub fn state_json(&self) -> String {
        // lock order is always session -> html, so text and html never come from different messages
        let (s, html) = {
            let s = self.session.lock().unwrap();
            let html = self.html.lock().unwrap().clone();
            (s.clone(), html)
        };
        serde_json::to_string(&cue_core::protocol::ServerMsg::State {
            settings: s.settings,
            text: s.text,
            html,
            name: s.name,
            rev: self.rev.load(Ordering::SeqCst),
        })
        .unwrap()
    }

    pub fn send(&self, from: u64, to: To, skip_sender: bool, json: String) {
        let _ = self.tx.send(Envelope {
            from,
            to,
            skip_sender,
            json: json.into(),
        });
    }

    pub fn broadcast_state(&self) {
        self.rev.fetch_add(1, Ordering::SeqCst);
        self.dirty.store(true, Ordering::SeqCst);
        let j = self.state_json();
        self.send(0, To::All, false, j);
    }

    /// Replace the script. Rendering can be slow for big input, so it runs on a
    /// blocking thread and never stalls the network tasks.
    pub async fn set_text(self: &Arc<Self>, text: String, name: Option<String>) {
        let src = text.clone();
        let html = tokio::task::spawn_blocking(move || markdown::render(&src))
            .await
            .unwrap_or_default();
        {
            let mut s = self.session.lock().unwrap();
            s.text = text;
            if let Some(n) = name {
                s.name = clean_name(&n);
            }
            *self.html.lock().unwrap() = html;
        }
        *self.last_pos.lock().unwrap() = Some((0.0, false));
        self.broadcast_state();
        // everyone sees the rewound position, and displays stop and go to the top
        // even when the new text renders identically to the old one
        self.send(
            0,
            To::All,
            false,
            serde_json::to_string(&cue_core::protocol::ServerMsg::Pos {
                p: 0.0,
                playing: false,
                eta: None,
            })
            .unwrap(),
        );
        for c in [cue_core::protocol::Cmd::Pause, cue_core::protocol::Cmd::Top] {
            self.send(
                0,
                To::Displays,
                false,
                serde_json::to_string(&cue_core::protocol::ServerMsg::Cmd(c)).unwrap(),
            );
        }
    }

    /// Whether this request may come from a browser page with this Origin.
    /// Our own pages (and the app's page talking to another hub) are served from
    /// an IP address or localhost; a page on a public website is not allowed to
    /// drive a hub on the visitor's machine.
    pub fn origin_ok(origin: Option<&str>, host: Option<&str>) -> bool {
        let Some(o) = origin else { return true }; // not a browser: PIN rules apply
        let Some(rest) = o.strip_prefix("http://") else {
            return false;
        };
        if host.map(|h| h == rest).unwrap_or(false) {
            return true; // same origin
        }
        let hostpart = rest.rsplit_once(':').map(|(h, _)| h).unwrap_or(rest);
        let hostpart = hostpart.trim_start_matches('[').trim_end_matches(']');
        hostpart == "localhost"
            || hostpart.ends_with(".local")
            || hostpart.parse::<std::net::IpAddr>().is_ok()
    }

    pub fn peers_json(&self) -> String {
        let p = self.peers.lock().unwrap();
        let displays = p.values().filter(|r| **r == Role::Display).count();
        let remotes = p.values().filter(|r| **r == Role::Remote).count();
        serde_json::to_string(&cue_core::protocol::ServerMsg::Peers { displays, remotes }).unwrap()
    }

    pub fn lan_urls(&self) -> Vec<String> {
        lan_ips()
            .into_iter()
            .map(|ip| format!("http://{}:{}", ip, self.port))
            .collect()
    }
}

/// This machine's LAN address(es). Asks the OS which local address it would use
/// to reach typical private networks (a UDP "connect" sends nothing). Works the
/// same on every platform, including Android 6 (which has no getifaddrs).
pub fn lan_ips() -> Vec<IpAddr> {
    let mut v = Vec::new();
    for probe in [
        "192.168.1.1:9",
        "10.0.0.1:9",
        "172.16.0.1:9",
        "192.168.0.1:9",
    ] {
        if let Ok(s) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if s.connect(probe).is_ok() {
                if let Ok(a) = s.local_addr() {
                    let ip = a.ip();
                    if !ip.is_loopback() && !ip.is_unspecified() && !v.contains(&ip) {
                        v.push(ip);
                    }
                }
            }
        }
    }
    v
}

/// A running hub.
pub struct Hub {
    pub addr: SocketAddr,
    pub pin: String,
    pub lan_urls: Vec<String>,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
}

impl Hub {
    /// Local URL that opens the UI already authenticated (for the embedded app).
    pub fn local_url(&self) -> String {
        format!("http://127.0.0.1:{}/#pin={}", self.addr.port(), self.pin)
    }

    pub async fn stop(mut self) {
        if let Some(s) = self.shutdown.take() {
            let _ = s.send(());
        }
        let _ = self.task.await;
    }

    /// Wait until the server task ends (headless binary).
    pub async fn wait(self) {
        let _ = self.task.await;
    }
}

fn load_or_create_pin(dir: &Path, wanted: Option<String>) -> String {
    // A PIN given by the user (--pin / CUEME_PIN) is used as is.
    if let Some(p) = wanted {
        let p = p.trim().to_string();
        if !p.is_empty() {
            return p;
        }
    }
    // Otherwise use the saved one, but only in today's format (3 digits);
    // an older 8-character PIN from a previous version is replaced.
    let f = dir.join("pin");
    if let Ok(s) = std::fs::read_to_string(&f) {
        let s = s.trim().to_string();
        if auth::is_generated_format(&s) {
            return s;
        }
    }
    let p = auth::generate_pin();
    let _ = std::fs::write(&f, &p);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600));
    }
    p
}

fn load_session(dir: &Path) -> Session {
    std::fs::read_to_string(dir.join("session.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Session>(&s).ok())
        .map(|mut s| {
            s.settings = s.settings.sanitized();
            s
        })
        .unwrap_or_else(|| Session {
            settings: Settings::default(),
            text: String::new(),
            name: String::new(),
        })
}

pub async fn start(cfg: Config) -> std::io::Result<Hub> {
    std::fs::create_dir_all(&cfg.data_dir)?;
    let lib = Library::open(&cfg.library_dir).map_err(|e| std::io::Error::other(e.to_string()))?;
    let pin = load_or_create_pin(&cfg.data_dir, cfg.pin.clone());
    let session = load_session(&cfg.data_dir);
    let html = markdown::render(&session.text);

    let listener = match tokio::net::TcpListener::bind(cfg.bind).await {
        Ok(l) => l,
        Err(e) if cfg.bind.port() != 0 && e.kind() == std::io::ErrorKind::AddrInUse => {
            // Another CueMe (or something else) owns the port: take any free one.
            let mut b = cfg.bind;
            b.set_port(0);
            tokio::net::TcpListener::bind(b).await?
        }
        Err(e) => return Err(e),
    };
    let addr = listener.local_addr()?;
    let (tx, _) = broadcast::channel(64);

    let found = beacon::Found::default();
    let shared = Arc::new(Shared {
        id: std::collections::hash_map::RandomState::new()
            .build_hasher()
            .finish(),
        pin: pin.clone(),
        name: cfg.name.clone(),
        port: addr.port(),
        session: Mutex::new(session),
        html: Mutex::new(html),
        rev: AtomicU64::new(1),
        lib,
        tx,
        next_id: AtomicU64::new(1),
        peers: Mutex::new(HashMap::new()),
        last_pos: Mutex::new(None),
        fails: Mutex::new(HashMap::new()),
        dirty: AtomicBool::new(false),
        data_dir: cfg.data_dir.clone(),
        library_dir: cfg.library_dir.clone(),
        found: found.clone(),
        native: cfg.native.clone(),
    });

    let beacon_tasks = if cfg.discovery && cfg.beacon_port != 0 {
        let targets = cfg
            .beacon_targets
            .clone()
            .unwrap_or_else(|| vec![SocketAddr::from(([255, 255, 255, 255], cfg.beacon_port))]);
        beacon::start(&shared, cfg.beacon_port, targets)
    } else {
        Vec::new()
    };

    let app = http::router(shared.clone());
    let (stx, srx) = oneshot::channel::<()>();
    let sh2 = shared.clone();
    let task = tokio::spawn(async move {
        // background session saver (at most one write per 2 s)
        let saver = tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if sh2.dirty.swap(false, Ordering::SeqCst) {
                    let s = sh2.session.lock().unwrap().clone();
                    if let Ok(j) = serde_json::to_string(&s) {
                        let tmp = sh2.data_dir.join("session.json.tmp");
                        if std::fs::write(&tmp, j).is_ok() {
                            let _ = std::fs::rename(&tmp, sh2.data_dir.join("session.json"));
                        }
                    }
                }
            }
        });
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = srx.await;
        })
        .await;
        saver.abort();
        // final flush
        if shared.dirty.swap(false, Ordering::SeqCst) {
            let s = shared.session.lock().unwrap().clone();
            if let Ok(j) = serde_json::to_string(&s) {
                let _ = std::fs::write(shared.data_dir.join("session.json"), j);
            }
        }
        for t in beacon_tasks {
            t.abort();
        }
    });

    let lan_urls = lan_ips()
        .into_iter()
        .map(|ip| format!("http://{}:{}", ip, addr.port()))
        .collect();
    Ok(Hub {
        addr,
        pin,
        lan_urls,
        shutdown: Some(stx),
        task,
    })
}
