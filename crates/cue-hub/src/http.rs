//! HTTP side: static web UI, library API, info, QR, discovery list.

use crate::{ws, Shared};
use axum::body::Body;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use cue_core::library::LibError;
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[derive(RustEmbed)]
#[folder = "../../web/"]
struct Assets;

type S = Arc<Shared>;

#[derive(Deserialize)]
pub struct PinQ {
    pub pin: Option<String>,
}

/// PIN from `x-cueme-pin` header or `?pin=`. Returns an error response if
/// missing/wrong/locked out.
#[allow(clippy::result_large_err)]
fn auth(sh: &Shared, ip: SocketAddr, headers: &HeaderMap, q: &PinQ) -> Result<(), Response> {
    let hdr = |n: &str| headers.get(n).and_then(|v| v.to_str().ok());
    // a page on a public website must not be able to probe PINs (or trigger lockouts) on this machine
    if !Shared::origin_ok(hdr("origin"), hdr("host")) {
        return Err((StatusCode::FORBIDDEN, "origin not allowed").into_response());
    }
    let ip = ip.ip();
    if sh.locked_out(ip) {
        return Err((StatusCode::TOO_MANY_REQUESTS, "too many attempts").into_response());
    }
    let given = headers
        .get("x-cueme-pin")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .or_else(|| q.pin.clone())
        .unwrap_or_default();
    if sh.pin_ok(&given) {
        Ok(())
    } else {
        sh.record_fail(ip);
        Err((StatusCode::UNAUTHORIZED, "bad pin").into_response())
    }
}

fn lib_err(e: LibError) -> Response {
    let code = match e {
        LibError::BadName => StatusCode::BAD_REQUEST,
        LibError::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        LibError::NotFound => StatusCode::NOT_FOUND,
        LibError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (code, e.to_string()).into_response()
}

pub fn router(sh: S) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::PUT,
            Method::DELETE,
            Method::POST,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE, HeaderName::from_static("x-cueme-pin")]);
    Router::new()
        .route("/ws", get(ws::handler))
        .route("/api/info", get(info))
        .route("/api/connect", get(connect))
        .route("/api/discover", get(discover))
        .route("/api/native/fullscreen", post(native_fullscreen))
        .route("/api/qr.svg", get(qr))
        .route("/api/library", get(lib_list))
        .route(
            "/api/library/{name}",
            get(lib_get).put(lib_put).delete(lib_del),
        )
        .fallback(static_file)
        .layer(cors)
        .layer(axum::middleware::map_response(security_headers))
        .with_state(sh)
}

async fn security_headers(mut r: Response) -> Response {
    let h = r.headers_mut();
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
             img-src 'self' data: http: https:; font-src 'self'; \
             connect-src 'self' http: https: ws: wss:; frame-ancestors 'none'; base-uri 'none'",
        ),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    r
}

async fn info(State(sh): State<S>) -> Json<serde_json::Value> {
    Json(json!({
        "app": "cueme",
        "version": crate::VERSION,
        "protocol": cue_core::protocol::PROTOCOL,
        "name": sh.name,
    }))
}

/// Everything a display needs to show "connect your remote" info.
async fn connect(
    State(sh): State<S>,
    ConnectInfo(ip): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<PinQ>,
) -> Response {
    if let Err(r) = auth(&sh, ip, &headers, &q) {
        return r;
    }
    let urls: Vec<String> = sh
        .lan_urls()
        .into_iter()
        .map(|u| format!("{u}/#pin={}", sh.pin))
        .collect();
    Json(json!({
        "urls": urls,
        "pin": sh.pin,
        "port": sh.port,
        "name": sh.name,
        "library": sh.library_dir.display().to_string(),
        "native": sh.native.is_some(),
    }))
    .into_response()
}

/// Only the display page of THIS machine may drive the app window (loopback only).
async fn native_fullscreen(
    State(sh): State<S>,
    ConnectInfo(ip): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<PinQ>,
) -> Response {
    if let Err(r) = auth(&sh, ip, &headers, &q) {
        return r;
    }
    if !ip.ip().is_loopback() {
        return StatusCode::FORBIDDEN.into_response();
    }
    match &sh.native {
        Some(n) => Json(json!({ "fullscreen": n.toggle_fullscreen() })).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn discover(
    State(sh): State<S>,
    ConnectInfo(ip): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<PinQ>,
) -> Response {
    if let Err(r) = auth(&sh, ip, &headers, &q) {
        return r;
    }
    Json(sh.found.list()).into_response()
}

#[derive(Deserialize)]
struct QrQ {
    text: String,
}

async fn qr(Query(q): Query<QrQ>) -> Response {
    if q.text.is_empty() || q.text.len() > 300 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match qrcode::QrCode::new(q.text.as_bytes()) {
        Ok(code) => {
            let svg = code
                .render::<qrcode::render::svg::Color>()
                .min_dimensions(240, 240)
                .quiet_zone(true)
                .dark_color(qrcode::render::svg::Color("#000000"))
                .light_color(qrcode::render::svg::Color("#ffffff"))
                .build();
            ([(header::CONTENT_TYPE, "image/svg+xml")], svg).into_response()
        }
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

async fn lib_list(
    State(sh): State<S>,
    ConnectInfo(ip): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<PinQ>,
) -> Response {
    if let Err(r) = auth(&sh, ip, &headers, &q) {
        return r;
    }
    match sh.lib.list() {
        Ok(v) => Json(v).into_response(),
        Err(e) => lib_err(e),
    }
}

async fn lib_get(
    State(sh): State<S>,
    ConnectInfo(ip): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<PinQ>,
    Path(name): Path<String>,
) -> Response {
    if let Err(r) = auth(&sh, ip, &headers, &q) {
        return r;
    }
    match sh.lib.read(&name) {
        Ok(t) => ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], t).into_response(),
        Err(e) => lib_err(e),
    }
}

async fn lib_put(
    State(sh): State<S>,
    ConnectInfo(ip): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<PinQ>,
    Path(name): Path<String>,
    body: String,
) -> Response {
    if let Err(r) = auth(&sh, ip, &headers, &q) {
        return r;
    }
    match sh.lib.write(&name, &body) {
        Ok(n) => {
            ws::announce_library(&sh);
            Json(json!({ "name": n })).into_response()
        }
        Err(e) => lib_err(e),
    }
}

async fn lib_del(
    State(sh): State<S>,
    ConnectInfo(ip): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<PinQ>,
    Path(name): Path<String>,
) -> Response {
    if let Err(r) = auth(&sh, ip, &headers, &q) {
        return r;
    }
    match sh.lib.delete(&name) {
        Ok(()) => {
            ws::announce_library(&sh);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => lib_err(e),
    }
}

async fn static_file(uri: Uri) -> Response {
    let p = uri.path().trim_start_matches('/');
    let p = if p.is_empty() { "index.html" } else { p };
    match Assets::get(p) {
        Some(f) => {
            let mime = mime_for(p);
            let cache = if p == "index.html" {
                "no-cache"
            } else {
                "public, max-age=3600"
            };
            Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .header(header::CACHE_CONTROL, cache)
                .body(Body::from(f.data.into_owned()))
                .unwrap()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn mime_for(p: &str) -> &'static str {
    match p.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "webmanifest" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
