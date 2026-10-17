// CueMe desktop: a native window around the CueMe hub that runs inside this
// process. The window shows the same UI every other CueMe uses; this process is
// also a hub, so other CueMe apps on the network can use it as display or remote.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct HubHandle(Mutex<Option<cue_hub::Hub>>);

/// Lets the display page (and so the remote) put THIS window in fullscreen,
/// which a browser would refuse without a tap on the display.
struct MainWindow(tauri::AppHandle);

impl cue_hub::Native for MainWindow {
    fn toggle_fullscreen(&self) -> bool {
        match self.0.get_webview_window("main") {
            Some(w) => {
                let on = !w.is_fullscreen().unwrap_or(false);
                let _ = w.set_fullscreen(on);
                on
            }
            None => false,
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let mut cfg = cue_hub::Config::with_data_dir(&data);
            // Scripts live in a normal, visible folder: ~/Documents/CueMe
            if let Ok(docs) = app.path().document_dir() {
                cfg.library_dir = docs.join("CueMe");
            }
            if let Ok(l) = std::env::var("CUEME_LIBRARY") {
                if !l.is_empty() {
                    cfg.library_dir = l.into();
                }
            }
            if let Ok(p) = std::env::var("CUEME_PIN") {
                if !p.is_empty() {
                    cfg.pin = Some(p);
                }
            }
            cfg.native = Some(std::sync::Arc::new(MainWindow(app.handle().clone())));
            let hub = tauri::async_runtime::block_on(cue_hub::start(cfg))?;
            let url = hub.local_url().parse()?;
            app.manage(HubHandle(Mutex::new(Some(hub))));
            // Window icon (taskbars that do not read the .desktop file use this one).
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("CueMe")
                .icon(icon)?
                .inner_size(1100.0, 720.0)
                .min_inner_size(360.0, 480.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building CueMe");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<HubHandle>() {
                if let Some(hub) = state.0.lock().unwrap().take() {
                    tauri::async_runtime::block_on(hub.stop());
                }
            }
        }
    });
}
