//! `cueme-serve`: run a CueMe hub without a window (Raspberry Pi, server, Docker).
//! Open the printed URL on any device (or in the CueMe apps).

use std::net::SocketAddr;
use std::path::PathBuf;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
        .or_else(|| {
            let key = format!(
                "CUEME_{}",
                name.trim_start_matches("--")
                    .to_uppercase()
                    .replace('-', "_")
            );
            std::env::var(key).ok().filter(|v| !v.is_empty())
        })
}

fn default_data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("XDG_DATA_HOME") {
        if !d.is_empty() {
            return PathBuf::from(d).join("cueme");
        }
    }
    if let Ok(h) = std::env::var("HOME") {
        return PathBuf::from(h).join(".local/share/cueme");
    }
    PathBuf::from("cueme-data")
}

const HELP: &str = "cueme-serve - headless CueMe hub\n\n\
  --bind ADDR      listen address            [0.0.0.0:7878]   (CUEME_BIND)\n\
  --data DIR       settings + PIN folder     [~/.local/share/cueme] (CUEME_DATA)\n\
  --library DIR    script folder (.md/.txt)  [<data>/scripts] (CUEME_LIBRARY)\n\
  --pin PIN        fixed PIN                 [saved/random]   (CUEME_PIN)\n\
  --name NAME      name shown on the LAN     [hostname]       (CUEME_NAME)\n\
  --no-discovery   do not announce/listen on the LAN (UDP 7879)\n\
  --version, --help\n";

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print!("{HELP}");
        return;
    }
    if args.iter().any(|a| a == "--version") {
        println!("cueme-serve {}", cue_hub::VERSION);
        return;
    }
    let data = arg(&args, "--data")
        .map(PathBuf::from)
        .unwrap_or_else(default_data_dir);
    let mut cfg = cue_hub::Config::with_data_dir(&data);
    if let Some(b) = arg(&args, "--bind") {
        match b.parse::<SocketAddr>() {
            Ok(a) => cfg.bind = a,
            Err(_) => {
                eprintln!("bad --bind address: {b}");
                std::process::exit(2);
            }
        }
    }
    if let Some(l) = arg(&args, "--library") {
        cfg.library_dir = PathBuf::from(l);
    }
    cfg.pin = arg(&args, "--pin");
    if let Some(n) = arg(&args, "--name") {
        cfg.name = n;
    }
    if args
        .iter()
        .any(|a| a == "--no-discovery" || a == "--no-mdns")
        || std::env::var("CUEME_NO_DISCOVERY").is_ok()
        || std::env::var("CUEME_NO_MDNS").is_ok()
    {
        cfg.discovery = false;
    }
    let hub = match cue_hub::start(cfg.clone()).await {
        Ok(h) => h,
        Err(e) => {
            eprintln!("cannot start: {e}");
            std::process::exit(1);
        }
    };
    println!("CueMe hub {} listening on {}", cue_hub::VERSION, hub.addr);
    println!("PIN: {}", hub.pin);
    println!("Library: {}", cfg.library_dir.display());
    for u in &hub.lan_urls {
        println!("Open: {u}/#pin={}", hub.pin);
    }
    println!(
        "Open: http://127.0.0.1:{}/#pin={}",
        hub.addr.port(),
        hub.pin
    );
    tokio::select! {
        _ = hub.wait() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
}
