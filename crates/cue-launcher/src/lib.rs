//! Optional "Add to app menu" for CueMe on Linux.
//!
//! The AppImage / plain binary never writes a menu entry or an icon by itself. When
//! the user asks (`cueme --install-launcher`, or the "Add to app menu" button) this
//! crate installs, for the CURRENT USER only:
//!
//!   * `$XDG_DATA_HOME/applications/cueme.desktop`   (default `~/.local/share/...`)
//!   * `$XDG_DATA_HOME/icons/hicolor/<N>x<N>/apps/cueme.png` for 16 24 32 48 64 128 256 512
//!   * `$XDG_DATA_HOME/icons/hicolor/scalable/apps/cueme.svg`
//!
//! Ownership rules (so we never damage a file that is not ours):
//!   * The entry we write carries the line `X-CueMe-Launcher=1`. An existing
//!     `cueme.desktop` WITHOUT that line (a package, home-manager, the user's own) is
//!     never overwritten and never removed.
//!   * Symlinks are somebody else's (home-manager, dotfiles repos): never touched.
//!   * Every icon we write is listed in `$XDG_DATA_HOME/cueme/launcher.manifest`.
//!     An existing icon is replaced only if it is listed there or is byte-identical to
//!     ours; uninstall removes only listed (or byte-identical) icons.
//!
//! The icons are compiled into the program, so this works from an AppImage, a tarball
//! or a loose binary with no other files next to it.

use std::fs;
use std::path::{Path, PathBuf};

/// Line that marks a desktop entry as written by this crate.
pub const MARKER: &str = "X-CueMe-Launcher=1";
/// The desktop file ID. It must equal the window's app id (see `APP_ID`).
pub const DESKTOP_FILE: &str = "cueme.desktop";
/// Wayland app id / X11 WM_CLASS of the window. The shell matches it with the
/// desktop file name (`cueme.desktop`) and `StartupWMClass=cueme`.
pub const APP_ID: &str = "cueme";

const SIZES: [(&str, &[u8]); 8] = [
    ("16x16", include_bytes!("../../../packaging/icons/16x16.png")),
    ("24x24", include_bytes!("../../../packaging/icons/24x24.png")),
    ("32x32", include_bytes!("../../../packaging/icons/32x32.png")),
    ("48x48", include_bytes!("../../../packaging/icons/48x48.png")),
    ("64x64", include_bytes!("../../../packaging/icons/64x64.png")),
    ("128x128", include_bytes!("../../../packaging/icons/128x128.png")),
    ("256x256", include_bytes!("../../../packaging/icons/256x256.png")),
    ("512x512", include_bytes!("../../../packaging/icons/512x512.png")),
];
const SVG: &[u8] = include_bytes!("../../../packaging/icons/cueme.svg");

/// `(path relative to the icons dir, bytes)` for every icon we ship.
fn icon_files() -> Vec<(String, &'static [u8])> {
    let mut v: Vec<(String, &'static [u8])> = SIZES
        .iter()
        .map(|(s, b)| (format!("hicolor/{s}/apps/cueme.png"), *b))
        .collect();
    v.push(("hicolor/scalable/apps/cueme.svg".to_string(), SVG));
    v
}

/// The user's data dir: `$XDG_DATA_HOME` (if absolute) or `~/.local/share`.
pub fn data_dir() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from) {
        if p.is_absolute() {
            return Some(p);
        }
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .map(|h| h.join(".local/share"))
}

/// The file the menu entry must start: the AppImage file itself when running from an
/// AppImage (inside it `current_exe` is a temporary mount that vanishes), otherwise
/// the program.
pub fn launcher_target() -> Result<PathBuf, String> {
    if let Some(v) = std::env::var_os("APPIMAGE") {
        let p = PathBuf::from(v);
        if p.is_absolute() && p.is_file() {
            return Ok(p);
        }
        return Err(format!("APPIMAGE points to {}, which is not a file", p.display()));
    }
    let exe = std::env::current_exe().map_err(|e| format!("cannot find this program: {e}"))?;
    if exe.to_string_lossy().contains("/.mount_") {
        return Err("run this from the AppImage file itself (the APPIMAGE variable is missing)".into());
    }
    Ok(exe)
}

/// `Exec=` value for a program path (Desktop Entry spec: quote, then escape `"` `` ` ``
/// `$` `\` inside the quotes, then double every backslash for the key-file layer;
/// a literal `%` must be written `%%`).
pub fn exec_value(path: &str) -> String {
    let mut inner = String::new();
    for c in path.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                inner.push('\\');
                inner.push(c);
            }
            '%' => inner.push_str("%%"),
            _ => inner.push(c),
        }
    }
    format!("\"{inner}\"").replace('\\', "\\\\")
}

/// `TryExec=` is a plain string: only the key-file layer applies (`\` -> `\\`).
fn try_exec_value(path: &str) -> String {
    path.replace('\\', "\\\\")
}

fn desktop_text(target: &Path) -> Result<String, String> {
    let s = target.to_str().ok_or("the program path is not valid UTF-8")?;
    if s.chars().any(|c| c.is_control()) {
        return Err("the program path contains control characters".into());
    }
    Ok(format!(
        "[Desktop Entry]\nType=Application\nVersion=1.0\nName=CueMe\nGenericName=Teleprompter\n\
         Comment=Teleprompter with Arabic/English Markdown, display or remote\n\
         Exec={exec}\nTryExec={try_exec}\nIcon=cueme\nTerminal=false\nCategories=Utility;\n\
         Keywords=teleprompter;prompter;autocue;cue;\nStartupWMClass={APP_ID}\nStartupNotify=true\n{MARKER}\n",
        exec = exec_value(s),
        try_exec = try_exec_value(s),
    ))
}

fn is_symlink(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(d) = path.parent() {
        fs::create_dir_all(d).map_err(|e| format!("cannot create {}: {e}", d.display()))?;
    }
    let tmp = path.with_extension("cueme-tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot write {}: {e}", path.display())
    })
}

fn manifest_path(data: &Path) -> PathBuf {
    data.join("cueme/launcher.manifest")
}

fn read_manifest(data: &Path) -> Vec<PathBuf> {
    let icons = data.join("icons");
    fs::read_to_string(manifest_path(data))
        .unwrap_or_default()
        .lines()
        .map(PathBuf::from)
        // never trust the manifest beyond our own icon names
        .filter(|p| p.starts_with(&icons) && p.file_stem().map(|s| s == "cueme").unwrap_or(false))
        .collect()
}

/// Is the desktop entry at `p` one we wrote?
fn ours(p: &Path) -> bool {
    !is_symlink(p) && fs::read_to_string(p).map(|t| t.lines().any(|l| l.trim() == MARKER)).unwrap_or(false)
}

/// What happened, one line per item, for the CLI and the app.
#[derive(Debug, Default)]
pub struct Report {
    pub lines: Vec<String>,
}

impl Report {
    fn add(&mut self, s: impl Into<String>) {
        self.lines.push(s.into());
    }
    pub fn text(&self) -> String {
        self.lines.join("\n")
    }
}

/// Is OUR entry installed for this user?
pub fn is_installed(data: &Path) -> bool {
    ours(&data.join("applications").join(DESKTOP_FILE))
}

/// Install (or refresh) the entry and the icons. Refuses, changing nothing, when a
/// `cueme.desktop` that is not ours is already there.
pub fn install(data: &Path, target: &Path) -> Result<Report, String> {
    let mut rep = Report::default();
    let entry = data.join("applications").join(DESKTOP_FILE);
    if is_symlink(&entry) || (entry.exists() && !ours(&entry)) {
        return Err(format!(
            "{} already exists and was not made by CueMe, so it is left alone.\n\
             Remove or rename it yourself if you want CueMe to manage the entry.",
            entry.display()
        ));
    }
    let text = desktop_text(target)?;

    // icons first: an entry must never point at icons that are missing
    let icons_dir = data.join("icons");
    let listed = read_manifest(data);
    let mut written: Vec<PathBuf> = Vec::new();
    for (rel, bytes) in icon_files() {
        let p = icons_dir.join(&rel);
        if is_symlink(&p) {
            rep.add(format!("kept {} (a symlink: not ours)", p.display()));
            continue;
        }
        if p.exists() {
            let same = fs::read(&p).map(|b| b == bytes).unwrap_or(false);
            if !same && !listed.contains(&p) {
                rep.add(format!("kept {} (another program's icon)", p.display()));
                continue;
            }
        }
        write_atomic(&p, bytes)?;
        written.push(p);
    }
    // icons that already matched and were ours before stay in the list
    let mut all = listed;
    for p in &written {
        if !all.contains(p) {
            all.push(p.clone());
        }
    }
    let mut m = String::new();
    for p in &all {
        if let Some(s) = p.to_str() {
            if !s.contains('\n') {
                m.push_str(s);
                m.push('\n');
            }
        }
    }
    write_atomic(&manifest_path(data), m.as_bytes())?;
    write_atomic(&entry, text.as_bytes())?;
    rep.add(format!("installed {}", entry.display()));
    rep.add(format!("installed {} icon files under {}", written.len(), icons_dir.display()));
    rep.add(format!("the menu entry starts {}", target.display()));
    Ok(rep)
}

/// Remove what `install` made, and nothing else.
pub fn uninstall(data: &Path) -> Result<Report, String> {
    let mut rep = Report::default();
    let entry = data.join("applications").join(DESKTOP_FILE);
    if ours(&entry) {
        fs::remove_file(&entry).map_err(|e| format!("cannot remove {}: {e}", entry.display()))?;
        rep.add(format!("removed {}", entry.display()));
    } else if entry.exists() || is_symlink(&entry) {
        rep.add(format!("kept {} (not made by CueMe)", entry.display()));
    } else {
        rep.add("no CueMe menu entry was installed");
    }
    let listed = read_manifest(data);
    let have_manifest = manifest_path(data).exists();
    let icons_dir = data.join("icons");
    let mut removed = 0;
    for (rel, bytes) in icon_files() {
        let p = icons_dir.join(&rel);
        if is_symlink(&p) || !p.is_file() {
            continue;
        }
        let same = fs::read(&p).map(|b| b == bytes).unwrap_or(false);
        // listed: ours even if an older version's picture; unlisted: only if identical
        if listed.contains(&p) || (!have_manifest && same) {
            if fs::remove_file(&p).is_ok() {
                removed += 1;
            }
        }
    }
    let _ = fs::remove_file(manifest_path(data));
    let _ = fs::remove_dir(data.join("cueme")); // only succeeds when empty
    if removed > 0 {
        rep.add(format!("removed {removed} icon files"));
    }
    Ok(rep)
}

/// Best effort: make menus and shells notice the change now. Quiet, never an error.
pub fn refresh_caches(data: &Path) {
    use std::process::{Command, Stdio};
    let quiet = |mut c: Command| {
        let _ = c.stdout(Stdio::null()).stderr(Stdio::null()).status();
    };
    let mut a = Command::new("update-desktop-database");
    a.arg(data.join("applications"));
    quiet(a);
    // Only refresh a cache that already exists. Without one GTK reads the folders
    // directly, and we do not want to leave a cache file behind that we cannot own.
    let hicolor = data.join("icons/hicolor");
    if hicolor.join("icon-theme.cache").exists() {
        let mut b = Command::new("gtk-update-icon-cache");
        b.args(["-f", "-t"]).arg(&hicolor);
        quiet(b);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn exec_quoting() {
        assert_eq!(exec_value("/home/a/CueMe.AppImage"), "\"/home/a/CueMe.AppImage\"");
        assert_eq!(exec_value("/home/a b/c"), "\"/home/a b/c\"");
        assert_eq!(exec_value("/h/100%/c"), "\"/h/100%%/c\"");
        assert_eq!(exec_value("/h/$x"), "\"/h/\\\\$x\"");
        assert_eq!(exec_value("/h/a\"b"), "\"/h/a\\\\\"b\"");
        assert_eq!(exec_value("/h/a\\b"), "\"/h/a\\\\\\\\b\"");
    }

    #[test]
    fn install_writes_entry_all_icons_and_manifest_then_uninstall_cleans() {
        let d = tmp();
        let rep = install(d.path(), Path::new("/opt/My Apps/CueMe.AppImage")).unwrap();
        assert!(rep.text().contains("installed"));
        let entry = fs::read_to_string(d.path().join("applications/cueme.desktop")).unwrap();
        assert!(entry.contains("Exec=\"/opt/My Apps/CueMe.AppImage\""));
        assert!(entry.contains("TryExec=/opt/My Apps/CueMe.AppImage"));
        assert!(entry.contains("StartupWMClass=cueme"));
        assert!(entry.contains(MARKER));
        for s in [16, 24, 32, 48, 64, 128, 256, 512] {
            let p = d.path().join(format!("icons/hicolor/{s}x{s}/apps/cueme.png"));
            assert!(p.is_file(), "missing {s}");
            assert_eq!(&fs::read(&p).unwrap()[1..4], b"PNG");
        }
        assert!(d.path().join("icons/hicolor/scalable/apps/cueme.svg").is_file());
        assert!(is_installed(d.path()));
        // running it again refreshes, never errors
        install(d.path(), Path::new("/x/CueMe.AppImage")).unwrap();
        let again = fs::read_to_string(d.path().join("applications/cueme.desktop")).unwrap();
        assert!(again.contains("/x/CueMe.AppImage"));

        let rep = uninstall(d.path()).unwrap();
        assert!(rep.text().contains("removed"));
        assert!(!d.path().join("applications/cueme.desktop").exists());
        assert!(!d.path().join("icons/hicolor/512x512/apps/cueme.png").exists());
        assert!(!d.path().join("cueme").exists());
        assert!(!is_installed(d.path()));
        // and uninstall twice is fine
        assert!(uninstall(d.path()).unwrap().text().contains("no CueMe menu entry"));
    }

    #[test]
    fn never_overwrites_or_removes_an_entry_it_did_not_make() {
        let d = tmp();
        let p = d.path().join("applications/cueme.desktop");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, "[Desktop Entry]\nName=Mine\nExec=cueme\n").unwrap();
        let e = install(d.path(), Path::new("/a/CueMe.AppImage")).unwrap_err();
        assert!(e.contains("was not made by CueMe"));
        assert_eq!(fs::read_to_string(&p).unwrap(), "[Desktop Entry]\nName=Mine\nExec=cueme\n");
        // nothing else was written either
        assert!(!d.path().join("icons").exists());
        let rep = uninstall(d.path()).unwrap();
        assert!(rep.text().contains("not made by CueMe"));
        assert!(p.exists());
    }

    #[test]
    fn symlinked_entry_is_not_ours() {
        let d = tmp();
        let real = d.path().join("elsewhere.desktop");
        fs::write(&real, format!("[Desktop Entry]\n{MARKER}\n")).unwrap();
        let p = d.path().join("applications/cueme.desktop");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&real, &p).unwrap();
        assert!(install(d.path(), Path::new("/a/b")).is_err());
        assert!(!is_installed(d.path()));
        uninstall(d.path()).unwrap();
        assert!(real.exists() && is_symlink(&p));
    }

    #[test]
    fn foreign_icon_is_kept_and_ours_replaced() {
        let d = tmp();
        let foreign = d.path().join("icons/hicolor/48x48/apps/cueme.png");
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        fs::write(&foreign, b"someone else's picture").unwrap();
        let rep = install(d.path(), Path::new("/a/b")).unwrap();
        assert!(rep.text().contains("another program's icon"));
        assert_eq!(fs::read(&foreign).unwrap(), b"someone else's picture");
        // uninstall leaves the foreign picture and removes ours
        uninstall(d.path()).unwrap();
        assert_eq!(fs::read(&foreign).unwrap(), b"someone else's picture");
        assert!(!d.path().join("icons/hicolor/32x32/apps/cueme.png").exists());
    }

    #[test]
    fn older_version_icon_that_we_listed_is_replaced_and_removed() {
        let d = tmp();
        install(d.path(), Path::new("/a/b")).unwrap();
        let p = d.path().join("icons/hicolor/64x64/apps/cueme.png");
        fs::write(&p, b"old picture from an earlier CueMe").unwrap(); // listed in the manifest
        install(d.path(), Path::new("/a/b")).unwrap();
        assert_eq!(&fs::read(&p).unwrap()[1..4], b"PNG");
        uninstall(d.path()).unwrap();
        assert!(!p.exists());
    }

    #[test]
    fn rejects_control_characters_in_the_path() {
        let d = tmp();
        assert!(install(d.path(), Path::new("/a/b\nExec=evil")).is_err());
        assert!(!d.path().join("applications/cueme.desktop").exists());
    }
}
