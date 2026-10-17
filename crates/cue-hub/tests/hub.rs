use cue_hub::{start, Config, Hub};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

async fn hub(dir: &std::path::Path) -> Hub {
    let mut c = Config::with_data_dir(dir);
    c.bind = "127.0.0.1:0".parse().unwrap();
    c.discovery = false;
    start(c).await.unwrap()
}

async fn conn(h: &Hub, role: &str) -> Ws {
    let (mut ws, _) = connect_async(format!("ws://{}/ws?pin={}", h.addr, h.pin))
        .await
        .unwrap();
    send(&mut ws, json!({"t":"hello","role":role})).await;
    ws
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

/// Read messages until one with `t == kind` (and optional predicate) arrives.
async fn wait_for(ws: &mut Ws, kind: &str, pred: impl Fn(&Value) -> bool) -> Value {
    let r = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(t))) => {
                    let v: Value = serde_json::from_str(t.as_str()).unwrap();
                    if v["t"] == kind && pred(&v) {
                        return v;
                    }
                }
                Some(Ok(_)) => {}
                other => panic!("socket ended: {other:?}"),
            }
        }
    })
    .await;
    r.unwrap_or_else(|_| panic!("timed out waiting for {kind}"))
}

async fn expect_silence(ws: &mut Ws, kind: &str) {
    let r = tokio::time::timeout(Duration::from_millis(400), async {
        loop {
            if let Some(Ok(Message::Text(t))) = ws.next().await {
                let v: Value = serde_json::from_str(t.as_str()).unwrap();
                if v["t"] == kind {
                    return v;
                }
            }
        }
    })
    .await;
    assert!(r.is_err(), "unexpected {kind} message");
}

#[tokio::test]
async fn bad_pin_is_rejected_then_locked_out() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let c = reqwest::Client::new();
    let base = format!("http://{}", h.addr);
    let r = c
        .get(format!("{base}/api/library?pin=WRONG"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    assert!(connect_async(format!("ws://{}/ws?pin=WRONG", h.addr))
        .await
        .is_err());
    // info is public, library with right pin works
    assert_eq!(
        c.get(format!("{base}/api/info"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let ok = c
        .get(format!("{base}/api/library"))
        .header("x-cueme-pin", &h.pin)
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);
    for _ in 0..12 {
        let _ = c.get(format!("{base}/api/library?pin=nope")).send().await;
    }
    // locked out even with the right pin
    let r = c
        .get(format!("{base}/api/library?pin={}", h.pin))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 429);
    h.stop().await;
}

#[tokio::test]
async fn commands_and_position_routing() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let mut display = conn(&h, "display").await;
    let mut remote = conn(&h, "remote").await;
    let mut remote2 = conn(&h, "remote").await;
    wait_for(&mut remote, "peers", |v| {
        v["displays"] == 1 && v["remotes"] == 2
    })
    .await;

    // remote -> display only, clamped
    send(&mut remote, json!({"t":"cmd","cmd":"seek","p":7.5})).await;
    let c = wait_for(&mut display, "cmd", |_| true).await;
    assert_eq!(c["cmd"], "seek");
    assert_eq!(c["p"], 1.0);
    expect_silence(&mut remote, "cmd").await;
    expect_silence(&mut remote2, "cmd").await;

    send(&mut remote, json!({"t":"cmd","cmd":"jog","v":-9})).await;
    assert_eq!(wait_for(&mut display, "cmd", |_| true).await["v"], -1.0);

    // display -> everyone else, live
    send(&mut display, json!({"t":"pos","p":0.42,"playing":true})).await;
    let p = wait_for(&mut remote, "pos", |_| true).await;
    assert_eq!(p["p"], 0.42);
    assert_eq!(p["playing"], true);
    wait_for(&mut remote2, "pos", |v| v["p"] == 0.42).await;

    // a remote cannot fake the position
    send(&mut remote, json!({"t":"pos","p":0.99,"playing":false})).await;
    expect_silence(&mut remote2, "pos").await;

    // late joiner immediately learns the position
    let mut late = conn(&h, "remote").await;
    wait_for(&mut late, "pos", |v| v["p"] == 0.42).await;
    h.stop().await;
}

#[tokio::test]
async fn text_is_rendered_safely_and_settings_clamped() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let mut display = conn(&h, "display").await;
    let mut remote = conn(&h, "remote").await;

    send(&mut remote, json!({"t":"text","text":"# مرحبا\n\nنص <script>alert(1)</script> and English","name":"ep1.md"})).await;
    let s = wait_for(&mut display, "state", |v| v["name"] == "ep1.md").await;
    let html = s["html"].as_str().unwrap();
    assert!(html.contains("<h1 dir=\"auto\">مرحبا</h1>"), "{html}");
    assert!(!html.contains("<script"), "{html}");
    wait_for(&mut remote, "state", |v| v["name"] == "ep1.md").await;

    send(&mut remote, json!({"t":"set","settings":{"font_size":100000,"width":3,"text_color":"javascript:x","flip_x":true}})).await;
    let s = wait_for(&mut display, "state", |v| v["settings"]["flip_x"] == true).await;
    assert_eq!(s["settings"]["font_size"], 400.0);
    assert_eq!(s["settings"]["width"], 20.0);
    assert_eq!(s["settings"]["text_color"], "#ffffff");

    // preview render goes only to the asker
    send(&mut remote, json!({"t":"render","text":"**x**"})).await;
    let r = wait_for(&mut remote, "rendered", |_| true).await;
    assert!(r["html"].as_str().unwrap().contains("<strong>x</strong>"));
    expect_silence(&mut display, "rendered").await;
    h.stop().await;
}

#[tokio::test]
async fn bad_messages_do_not_kill_the_session() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let mut ws = conn(&h, "remote").await;
    ws.send(Message::Text("not json".to_string().into()))
        .await
        .unwrap();
    wait_for(&mut ws, "error", |_| true).await;
    send(&mut ws, json!({"t":"render","text":"ok"})).await;
    wait_for(&mut ws, "rendered", |_| true).await;
    h.stop().await;
}

#[tokio::test]
async fn library_over_http_and_ws() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let c = reqwest::Client::new();
    let base = format!("http://{}/api/library", h.addr);
    let pin = h.pin.clone();
    let mut remote = conn(&h, "remote").await;

    let r = c
        .put(format!("{base}/حلقة"))
        .header("x-cueme-pin", &pin)
        .body("نص عربي")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    wait_for(&mut remote, "library", |v| v["files"] == json!(["حلقة.md"])).await;

    let t = c
        .get(format!("{base}/%D8%AD%D9%84%D9%82%D8%A9.md"))
        .header("x-cueme-pin", &pin)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(t, "نص عربي");

    // traversal / bad names
    for bad in [
        "..%2Fsecret.md",
        "%2e%2e%2fsecret.md",
        "evil.exe",
        ".hidden",
    ] {
        let r = c
            .put(format!("{base}/{bad}"))
            .header("x-cueme-pin", &pin)
            .body("x")
            .send()
            .await
            .unwrap();
        assert!(
            r.status() == 400 || r.status() == 404,
            "{bad}: {}",
            r.status()
        );
    }
    assert!(!d.path().join("secret.md").exists());

    // load into session via websocket, save back via websocket
    send(&mut remote, json!({"t":"load","name":"حلقة.md"})).await;
    let s = wait_for(&mut remote, "state", |v| v["name"] == "حلقة.md").await;
    assert_eq!(s["text"], "نص عربي");
    send(
        &mut remote,
        json!({"t":"save","name":"second","text":"two"}),
    )
    .await;
    wait_for(&mut remote, "library", |v| {
        v["files"].as_array().unwrap().len() == 2
    })
    .await;
    send(&mut remote, json!({"t":"load","name":"missing.md"})).await;
    wait_for(&mut remote, "error", |_| true).await;

    let r = c
        .delete(format!("{base}/second.md"))
        .header("x-cueme-pin", &pin)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);
    h.stop().await;
}

#[tokio::test]
async fn session_and_pin_survive_restart() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let pin = h.pin.clone();
    let mut ws = conn(&h, "remote").await;
    send(
        &mut ws,
        json!({"t":"text","text":"remember me","name":"r.md"}),
    )
    .await;
    send(&mut ws, json!({"t":"set","settings":{"font_size":123}})).await;
    wait_for(&mut ws, "state", |v| v["settings"]["font_size"] == 123.0).await;
    h.stop().await; // final flush on shutdown

    let h2 = hub(d.path()).await;
    assert_eq!(h2.pin, pin);
    let mut ws = conn(&h2, "remote").await;
    let s = wait_for(&mut ws, "state", |_| true).await;
    assert_eq!(s["text"], "remember me");
    assert_eq!(s["settings"]["font_size"], 123.0);
    h2.stop().await;
}

#[tokio::test]
async fn static_ui_headers_and_qr() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let c = reqwest::Client::new();
    let r = c.get(format!("http://{}/", h.addr)).send().await.unwrap();
    assert_eq!(r.status(), 200);
    assert!(r.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("script-src 'self'"));
    assert_eq!(r.headers()["x-content-type-options"], "nosniff");
    assert_eq!(
        c.get(format!("http://{}/nope.js", h.addr))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    let q = c
        .get(format!("http://{}/api/qr.svg?text=hello", h.addr))
        .send()
        .await
        .unwrap();
    assert!(q.text().await.unwrap().contains("<svg"));
    h.stop().await;
}

// ---------------------------------------------------------------- discovery

fn free_udp_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[tokio::test]
async fn hubs_find_each_other_with_the_beacon() {
    let (pa, pb) = (free_udp_port(), free_udp_port());
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mk = |dir: &std::path::Path, name: &str, mine: u16, other: u16| {
        let mut c = Config::with_data_dir(dir);
        c.bind = "127.0.0.1:0".parse().unwrap();
        c.name = name.into();
        c.discovery = true;
        c.beacon_port = mine;
        c.beacon_targets = Some(vec![format!("127.0.0.1:{other}").parse().unwrap()]);
        c
    };
    let a = start(mk(da.path(), "Studio-PC", pa, pb)).await.unwrap();
    let b = start(mk(db.path(), "Phone", pb, pa)).await.unwrap();
    let client = reqwest::Client::new();

    // A should hear B (and only B)
    let mut seen = String::new();
    for _ in 0..40 {
        seen = client
            .get(format!("http://{}/api/discover", a.addr))
            .header("x-cueme-pin", &a.pin)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        if seen.contains("Phone") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let v: Value = serde_json::from_str(&seen).unwrap();
    assert_eq!(v.as_array().unwrap().len(), 1, "{seen}");
    assert_eq!(v[0]["name"], "Phone");
    assert_eq!(v[0]["port"], b.addr.port());
    assert_eq!(v[0]["addrs"][0], "127.0.0.1");
    // discovery list needs the PIN
    let r = client
        .get(format!("http://{}/api/discover", a.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    a.stop().await;
    b.stop().await;
}

// ------------------------------------------------- native window + connect info

struct FakeWindow(std::sync::atomic::AtomicBool);
impl cue_hub::Native for FakeWindow {
    fn toggle_fullscreen(&self) -> bool {
        !self.0.fetch_xor(true, std::sync::atomic::Ordering::SeqCst)
    }
}

#[tokio::test]
async fn app_window_fullscreen_hook_and_connect_info() {
    let d = tempfile::tempdir().unwrap();
    let mut c = Config::with_data_dir(d.path());
    c.bind = "127.0.0.1:0".parse().unwrap();
    c.discovery = false;
    c.native = Some(std::sync::Arc::new(FakeWindow(Default::default())));
    let h = start(c).await.unwrap();
    let cl = reqwest::Client::new();
    let base = format!("http://{}", h.addr);

    let info: Value = cl
        .get(format!("{base}/api/connect"))
        .header("x-cueme-pin", &h.pin)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["native"], true);
    assert!(info["library"].as_str().unwrap().ends_with("scripts"));
    assert_eq!(info["pin"], h.pin.as_str());

    let on: Value = cl
        .post(format!("{base}/api/native/fullscreen"))
        .header("x-cueme-pin", &h.pin)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(on["fullscreen"], true);
    let off: Value = cl
        .post(format!("{base}/api/native/fullscreen"))
        .header("x-cueme-pin", &h.pin)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(off["fullscreen"], false);
    // needs the PIN
    assert_eq!(
        cl.post(format!("{base}/api/native/fullscreen"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    h.stop().await;

    // a plain hub (browser/headless) has no window to control
    let d2 = tempfile::tempdir().unwrap();
    let h2 = hub(d2.path()).await;
    let r = cl
        .post(format!("http://{}/api/native/fullscreen", h2.addr))
        .header("x-cueme-pin", &h2.pin)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 404);
    let info: Value = cl
        .get(format!("http://{}/api/connect", h2.addr))
        .header("x-cueme-pin", &h2.pin)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["native"], false);
    h2.stop().await;
}

#[tokio::test]
async fn goto_heading_is_relayed_and_pin_format() {
    let d = tempfile::tempdir().unwrap();
    // an old 8-character saved PIN is replaced by a 3-digit one
    std::fs::write(d.path().join("pin"), "ABCD2345").unwrap();
    let h = hub(d.path()).await;
    assert_eq!(h.pin.len(), 3);
    assert!(h.pin.bytes().all(|c| c.is_ascii_digit()), "{}", h.pin);
    let mut display = conn(&h, "display").await;
    let mut remote = conn(&h, "remote").await;
    wait_for(&mut remote, "peers", |v| v["displays"] == 1).await;
    send(
        &mut remote,
        json!({"t":"cmd","cmd":"goto_heading","index":12}),
    )
    .await;
    let c = wait_for(&mut display, "cmd", |_| true).await;
    assert_eq!(c["cmd"], "goto_heading");
    assert_eq!(c["index"], 12);
    // the generated PIN is saved and reused
    let again = std::fs::read_to_string(d.path().join("pin")).unwrap();
    assert_eq!(again.trim(), h.pin);
    h.stop().await;
}

#[tokio::test]
async fn public_web_pages_cannot_probe_the_hub() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let c = reqwest::Client::new();
    let base = format!("http://{}", h.addr);
    // a page on a normal website: refused before the PIN is even looked at, and without
    // counting towards the lockout (so it cannot lock the real user out either)
    for _ in 0..15 {
        let r = c
            .get(format!("{base}/api/library?pin=000"))
            .header("origin", "https://evil.example")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 403);
    }
    // the app's own pages (IP address / localhost origins) still work
    for o in [
        format!("http://{}", h.addr),
        "http://127.0.0.1:1234".to_string(),
        "http://192.168.1.20:7878".to_string(),
        "http://localhost:7878".to_string(),
    ] {
        let r = c
            .get(format!("{base}/api/library?pin={}", h.pin))
            .header("origin", &o)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200, "origin {o}");
    }
    // browsers also send Origin on WebSocket upgrades
    let mut req = format!("ws://{}/ws?pin={}", h.addr, h.pin)
        .into_client_request()
        .unwrap();
    req.headers_mut()
        .insert("origin", "https://evil.example".parse().unwrap());
    assert!(connect_async(req).await.is_err());
}

#[tokio::test]
async fn state_is_consistent_after_display_leaves_and_text_resend() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let mut display = conn(&h, "display").await;
    let mut remote = conn(&h, "remote").await;
    send(&mut display, json!({"t":"pos","p":0.5,"playing":true})).await;
    wait_for(&mut remote, "pos", |v| v["playing"] == true).await;
    // the display vanishes: remotes must stop showing "playing"
    drop(display);
    wait_for(&mut remote, "pos", |v| v["playing"] == false).await;
    // sending the same text twice still tells displays to stop and go to the top
    let mut display2 = conn(&h, "display").await;
    send(&mut remote, json!({"t":"text","text":"# a\n\nb"})).await;
    send(&mut remote, json!({"t":"text","text":"# a\n\nb"})).await;
    wait_for(&mut display2, "cmd", |v| v["cmd"] == "top").await;
    wait_for(&mut remote, "pos", |v| {
        v["p"] == 0.0 && v["playing"] == false
    })
    .await;
}

#[tokio::test]
async fn huge_or_nested_text_does_not_blow_up_and_names_are_bounded() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let mut ws = conn(&h, "remote").await;
    let evil = ">".repeat(500_000) + " x";
    send(
        &mut ws,
        json!({"t":"text","text":evil,"name":"n".repeat(100_000)}),
    )
    .await;
    let st = wait_for(&mut ws, "state", |v| {
        v["text"]
            .as_str()
            .map(|t| t.len() > 100_000)
            .unwrap_or(false)
    })
    .await;
    assert!(st["html"].as_str().unwrap().len() < 4_000_000);
    assert!(st["name"].as_str().unwrap().chars().count() <= 120);
}

#[tokio::test]
async fn native_quit_needs_the_app_and_the_pin() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    let c = reqwest::Client::new();
    let base = format!("http://{}", h.addr);
    let r = c
        .post(format!("{base}/api/native/quit?pin={}", h.pin))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 404, "a plain hub has no window to close");
    let r = c
        .post(format!("{base}/api/native/quit?pin=bad"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    // browsers get the heartbeat the page uses to notice dead connections
    let mut ws = conn(&h, "remote").await;
    wait_for(&mut ws, "ping", |_| true).await;
}

#[tokio::test]
async fn rooms_are_independent_and_listed() {
    let d = tempfile::tempdir().unwrap();
    let h = hub(d.path()).await;
    // two private sessions and the shared one
    let open = |room: &str, role: &str| {
        let url = format!("ws://{}/ws?pin={}&room={}", h.addr, h.pin, room);
        let role = role.to_string();
        async move {
            let (mut ws, _) = connect_async(url).await.unwrap();
            send(&mut ws, json!({"t":"hello","role":role})).await;
            ws
        }
    };
    let mut a_disp = open("aaa", "display").await;
    let mut a_rem = open("aaa", "remote").await;
    let mut b_disp = open("bbb", "display").await;
    let mut main_rem = conn(&h, "remote").await;
    send(&mut a_rem, json!({"t":"text","text":"# only A"})).await;
    wait_for(&mut a_disp, "state", |v| v["text"] == "# only A").await;
    // the other session and the shared one never see it
    wait_for(&mut b_disp, "state", |v| v["text"] == "").await;
    expect_silence(&mut main_rem, "cmd").await;
    // listing: main + the two rooms that have a display
    let base = format!("http://{}", h.addr);
    let l: Value = reqwest::get(format!("{base}/api/rooms?pin={}", h.pin))
        .await.unwrap().json().await.unwrap();
    assert_eq!(l.as_array().unwrap().len(), 3);
    // a bad room name is refused (after the PIN check)
    assert!(connect_async(format!("ws://{}/ws?pin={}&room=../x", h.addr, h.pin)).await.is_err());
    h.stop().await;
}

#[tokio::test]
async fn pin_none_means_open_but_foreign_origin_still_refused() {
    let d = tempfile::tempdir().unwrap();
    let mut c = Config::with_data_dir(d.path());
    c.bind = "127.0.0.1:0".parse().unwrap();
    c.discovery = false;
    c.pin = Some("none".into());
    let h = start(c).await.unwrap();
    assert_eq!(h.pin, "");
    // no PIN needed from a plain client
    let (mut ws, _) = connect_async(format!("ws://{}/ws", h.addr)).await.unwrap();
    send(&mut ws, json!({"t":"hello","role":"display"})).await;
    wait_for(&mut ws, "state", |_| true).await;
    // but a web page on another site is still refused
    let mut req = format!("ws://{}/ws", h.addr).into_client_request().unwrap();
    req.headers_mut().insert("origin", "https://evil.example".parse().unwrap());
    assert!(connect_async(req).await.is_err());
    // DNS rebinding: a public name pointed at this machine has Origin == Host but is not a home-network name
    let mut req = format!("ws://{}/ws", h.addr).into_client_request().unwrap();
    req.headers_mut().insert("origin", "http://evil.com:7878".parse().unwrap());
    req.headers_mut().insert("host", "evil.com:7878".parse().unwrap());
    assert!(connect_async(req).await.is_err());
    // a public IP literal as origin is refused too
    let mut req = format!("ws://{}/ws", h.addr).into_client_request().unwrap();
    req.headers_mut().insert("origin", "http://203.0.113.5".parse().unwrap());
    assert!(connect_async(req).await.is_err());
    // behind a proxy: https page whose origin equals the Host header is fine
    let mut req = format!("ws://{}/ws", h.addr).into_client_request().unwrap();
    req.headers_mut().insert("origin", "https://cueme.hs.lan".parse().unwrap());
    req.headers_mut().insert("host", "cueme.hs.lan".parse().unwrap());
    assert!(connect_async(req).await.is_ok());
    h.stop().await;
}
