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
}

/// Makes the window icon work for an AppImage / plain binary on Wayland.
///
/// Wayland has no "set window icon" call: the desktop shell looks the icon up through
/// the app id (`cueme`) -> `cueme.desktop` -> icon `cueme`. An installed .deb provides
/// those; an AppImage or loose binary does not, so on first start we put the same two
/// small things in the user's own folders (`~/.local/share/applications` and
/// `~/.local/share/icons`), pointing at this file. Nothing outside the home folder is
/// touched; set CUEME_NO_INTEGRATION=1 to skip it. It is skipped for system installs.
#[cfg(target_os = "linux")]
fn integrate_desktop() {
    use std::os::unix::fs::MetadataExt;
    use std::path::PathBuf;
    if std::env::var_os("CUEME_NO_INTEGRATION").is_some() {
        return;
    }
    // never as root (sudo keeps $HOME and would leave root-owned files in the user's home)
    if std::fs::metadata("/proc/self").map(|m| m.uid() == 0).unwrap_or(true) {
        return;
    }
    let appimage_var = std::env::var_os("APPIMAGE");
    let exe: PathBuf = match &appimage_var {
        Some(v) => {
            let p = PathBuf::from(v);
            if !p.is_file() {
                return; // set but wrong: do not guess
            }
            p
        }
        None => match std::env::current_exe() {
            Ok(p) => p,
            Err(_) => return,
        },
    };
    let s = exe.to_string_lossy().to_string();
    let appimage = appimage_var.is_some();
    if !appimage
        && (s.starts_with("/usr/")
            || s.starts_with("/nix/store/")
            || s.starts_with("/opt/")
            || s.contains("/target/debug/")
            || s.contains("/target/release/")
            || s.contains("/.mount_"))
    {
        return; // installed by a package, or a developer build: no launcher needed
    }
    // the Exec line has its own escaping rules: only integrate for plain, safe paths
    if s.chars().any(|c| c.is_control() || matches!(c, '%' | '$' | '`' | '"' | '\\' | '\'' | '\n')) {
        return;
    }
    let home = match std::env::var_os("HOME") {
        Some(h) => PathBuf::from(h),
        None => return,
    };
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home.join(".local/share"));

    fn put(path: &std::path::Path, bytes: &[u8]) -> bool {
        if std::fs::read(path).map(|b| b == bytes).unwrap_or(false) {
            return false;
        }
        // a symlink (home-manager, dotfiles repo) is somebody else's file: leave it alone
        if std::fs::symlink_metadata(path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return false;
        }
        if let Some(d) = path.parent() {
            if std::fs::create_dir_all(d).is_err() {
                return false;
            }
        }
        let tmp = path.with_extension("tmp-cueme");
        if std::fs::write(&tmp, bytes).is_err() {
            return false;
        }
        if std::fs::rename(&tmp, path).is_err() {
            let _ = std::fs::remove_file(&tmp);
            return false;
        }
        true
    }
    // Exec needs quoting when the path has spaces
    let exec = format!("\"{s}\"");
    let desktop = format!(
        "[Desktop Entry]\nType=Application\nVersion=1.0\nName=CueMe\nGenericName=Teleprompter\n\
         Comment=Teleprompter with Arabic/English Markdown, display or remote\nExec={exec}\nIcon=cueme\n\
         Terminal=false\nCategories=Utility;\nKeywords=teleprompter;prompter;autocue;cue;\nStartupWMClass=cueme\n"
    );
    let mut changed = put(&data.join("applications/cueme.desktop"), desktop.as_bytes());
    for (size, bytes) in [
        (32, &include_bytes!("../icons/32x32.png")[..]),
        (128, &include_bytes!("../icons/128x128.png")[..]),
        (256, &include_bytes!("../../assets/icon-256.png")[..]),
        (512, &include_bytes!("../../assets/icon-512.png")[..]),
    ] {
        changed |= put(&data.join(format!("icons/hicolor/{size}x{size}/apps/cueme.png")), bytes);
    }
    if changed {
        // best effort, off the startup path: make menus / shells notice right away
        std::thread::spawn(move || {
            let quiet = || (std::process::Stdio::null(), std::process::Stdio::null());
            let (o, e) = quiet();
            let _ = std::process::Command::new("update-desktop-database")
                .arg(data.join("applications"))
                .stdout(o)
                .stderr(e)
                .status();
            let (o, e) = quiet();
            let _ = std::process::Command::new("gtk-update-icon-cache")
                .args(["-f", "-t"])
                .arg(data.join("icons/hicolor"))
                .stdout(o)
                .stderr(e)
                .status();
        });
    }
}

#[cfg(not(target_os = "linux"))]
fn integrate_desktop() {}

fn main() {
    integrate_desktop();
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
