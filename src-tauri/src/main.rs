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

    fn quit(&self) {
        self.0.exit(0);
    }

    fn launcher(&self) -> Option<bool> {
        launcher_state()
    }

    fn set_launcher(&self, on: bool) -> Result<String, String> {
        launcher_set(on)
    }
}

/// The per-user app-menu entry, driven by the "Add to app menu" button.
///
/// NOTHING is written unless the user asks: not at start-up, not in an AppImage. The
/// same code is behind `cueme --install-launcher` (see `cli`).
#[cfg(target_os = "linux")]
fn launcher_state() -> Option<bool> {
    cue_launcher::data_dir().map(|d| cue_launcher::is_installed(&d))
}

#[cfg(target_os = "linux")]
fn launcher_set(on: bool) -> Result<String, String> {
    let data = cue_launcher::data_dir().ok_or("cannot find your data folder (HOME is not set)")?;
    let rep = if on {
        cue_launcher::install(&data, &cue_launcher::launcher_target()?)?
    } else {
        cue_launcher::uninstall(&data)?
    };
    // menus notice the change without a re-login; off this thread so the button stays quick
    std::thread::spawn(move || cue_launcher::refresh_caches(&data));
    Ok(rep.text())
}

#[cfg(not(target_os = "linux"))]
fn launcher_state() -> Option<bool> {
    None
}

#[cfg(not(target_os = "linux"))]
fn launcher_set(_on: bool) -> Result<String, String> {
    Err("not supported".into())
}

const HELP: &str = "CueMe - teleprompter, display and remote in one app

Usage: cueme [OPTION]

  --install-launcher    add CueMe to your app menu (this user only): a menu entry and
                        the icons, in ~/.local/share. Never overwrites an entry that
                        CueMe did not make.
  --uninstall-launcher  remove exactly what --install-launcher added
  -V, --version         print the version
  -h, --help            this text

Without options the app starts. An AppImage or plain binary never adds a menu entry
or icons by itself.";

/// Command-line actions that must work without a display and without starting the app.
/// Returns the exit code when one of them ran.
fn cli() -> Option<i32> {
    let mut code = None;
    for a in std::env::args().skip(1) {
        match a.as_str() {
            "-h" | "--help" => {
                println!("{HELP}");
                return Some(0);
            }
            "-V" | "--version" => {
                println!("cueme {}", env!("CARGO_PKG_VERSION"));
                return Some(0);
            }
            "--install-launcher" | "--uninstall-launcher" => {
                let on = a == "--install-launcher";
                #[cfg(target_os = "linux")]
                let res = launcher_set_blocking(on);
                #[cfg(not(target_os = "linux"))]
                let res: Result<String, String> = Err("this only exists on Linux".into());
                match res {
                    Ok(m) => {
                        println!("{m}");
                        code = Some(0);
                    }
                    Err(e) => {
                        eprintln!("cueme: {e}");
                        return Some(1);
                    }
                }
            }
            _ => {}
        }
    }
    code
}

/// Like `launcher_set`, but waits for the cache refresh (a command line has no hurry).
#[cfg(target_os = "linux")]
fn launcher_set_blocking(on: bool) -> Result<String, String> {
    let data = cue_launcher::data_dir().ok_or("cannot find your data folder (HOME is not set)")?;
    let rep = if on {
        cue_launcher::install(&data, &cue_launcher::launcher_target()?)?
    } else {
        cue_launcher::uninstall(&data)?
    };
    cue_launcher::refresh_caches(&data);
    Ok(rep.text())
}

/// Wayland has no "window class" call: the shell matches a window to its menu entry
/// through the app id, and GTK takes that from the program name (and for X11 / XWayland
/// the window class name). The program name would otherwise depend on how we were
/// started (`AppRun`, a renamed file, a symlink), so we set it to `cueme` explicitly.
/// It must equal the desktop file name `cueme.desktop` and `StartupWMClass=cueme`.
/// It has to be set before GTK starts. (`gdk::set_program_class` is not used: the gtk
/// bindings refuse to call it before GTK is initialised, and it only changes the X11
/// class that `StartupWMClass` already matches through the name.)
#[cfg(target_os = "linux")]
fn set_app_id() {
    gtk::glib::set_prgname(Some(cue_launcher::APP_ID));
}

#[cfg(not(target_os = "linux"))]
fn set_app_id() {}

fn main() {
    if let Some(code) = cli() {
        std::process::exit(code);
    }
    set_app_id();
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
