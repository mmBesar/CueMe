//! JNI bridge: lets the Android app (Java) run the CueMe hub in-process.
//!
//! The Java side (`app.cueme.android.Hub`) calls `nativeStart` once, gets back
//! "port|pin", and points a WebView at `http://127.0.0.1:port/#pin=...`.
//! LAN discovery is plain UDP broadcast, so it works on Android 6 too.

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use std::path::PathBuf;
use std::sync::Mutex;

struct Running {
    rt: tokio::runtime::Runtime,
    hub: cue_hub::Hub,
}

static HUB: Mutex<Option<Running>> = Mutex::new(None);

fn info(h: &cue_hub::Hub) -> String {
    let urls = h.lan_urls.join(",");
    format!("{}|{}|{}", h.addr.port(), h.pin, urls)
}

fn start(data_dir: String, library_dir: String, name: String) -> Result<String, String> {
    let mut g = HUB.lock().map_err(|_| "poisoned".to_string())?;
    if let Some(r) = g.as_ref() {
        return Ok(info(&r.hub));
    }
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let mut cfg = cue_hub::Config::with_data_dir(PathBuf::from(data_dir));
    cfg.library_dir = PathBuf::from(library_dir);
    if !name.is_empty() {
        cfg.name = name;
    }
    let hub = rt
        .block_on(cue_hub::start(cfg))
        .map_err(|e| e.to_string())?;
    let out = info(&hub);
    *g = Some(Running { rt, hub });
    Ok(out)
}

fn stop() {
    if let Ok(mut g) = HUB.lock() {
        if let Some(r) = g.take() {
            r.rt.block_on(r.hub.stop());
            r.rt.shutdown_background();
        }
    }
}

fn jstr(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s).map(|s| s.into()).unwrap_or_default()
}

#[no_mangle]
pub extern "system" fn Java_app_cueme_android_Hub_nativeStart<'l>(
    mut env: JNIEnv<'l>,
    _class: JClass<'l>,
    data_dir: JString<'l>,
    library_dir: JString<'l>,
    name: JString<'l>,
) -> jstring {
    let d = jstr(&mut env, &data_dir);
    let l = jstr(&mut env, &library_dir);
    let n = jstr(&mut env, &name);
    let res = match std::panic::catch_unwind(|| start(d, l, n)) {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => format!("ERR:{e}"),
        Err(_) => "ERR:panic".to_string(),
    };
    env.new_string(res)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_app_cueme_android_Hub_nativeStop<'l>(
    _env: JNIEnv<'l>,
    _class: JClass<'l>,
) {
    let _ = std::panic::catch_unwind(stop);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_stop_cycle() {
        let d = std::env::temp_dir().join(format!("cueme-android-test-{}", std::process::id()));
        let s = start(
            d.to_string_lossy().into(),
            d.join("scripts").to_string_lossy().into(),
            "T".into(),
        )
        .unwrap();
        let parts: Vec<&str> = s.split('|').collect();
        assert!(parts[0].parse::<u16>().unwrap() > 0);
        assert_eq!(parts[1].len(), 3);
        assert!(parts[1].chars().all(|c| c.is_ascii_digit()));
        // second start returns the same instance
        assert_eq!(start("x".into(), "y".into(), "".into()).unwrap(), s);
        stop();
        assert!(HUB.lock().unwrap().is_none());
        let _ = std::fs::remove_dir_all(d);
    }
}
