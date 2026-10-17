//! The script library: a folder of `.md` / `.txt` files.
//!
//! Names are validated hard: no path separators, no leading dot, no NUL or
//! control characters, only `.md` / `.txt`, so a network peer can never read
//! or write outside the folder.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum LibError {
    #[error("invalid file name")]
    BadName,
    #[error("file too large")]
    TooLarge,
    #[error("not found")]
    NotFound,
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone)]
pub struct Library {
    root: PathBuf,
}

/// Returns the normalised name (default extension `.md`) or an error.
pub fn validate_name(raw: &str) -> Result<String, LibError> {
    let n = raw.trim();
    if n.is_empty()
        || n.len() > 200
        || n.starts_with('.')
        || n.chars().any(|c| {
            c.is_control()
                || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                // invisible direction/format characters can disguise a file name
                || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
        })
    {
        return Err(LibError::BadName);
    }
    let lower = n.to_lowercase();
    // names Windows cannot use: refusing them keeps a library portable
    let stem0 = lower.split('.').next().unwrap_or("").trim_end();
    if matches!(stem0, "con" | "prn" | "aux" | "nul")
        || ((stem0.starts_with("com") || stem0.starts_with("lpt"))
            && stem0.len() == 4
            && stem0.as_bytes()[3].is_ascii_digit())
        || n.ends_with(' ')
        || n.ends_with('.')
    {
        return Err(LibError::BadName);
    }
    for ext in [".md", ".txt"] {
        if lower.ends_with(ext) {
            let stem = &n[..n.len() - ext.len()];
            if stem.trim().is_empty() || stem.chars().all(|c| c == '.') {
                return Err(LibError::BadName);
            }
            return Ok(n.to_string());
        }
    }
    // Some other extension (letters, <=5 chars) is refused; "episode 2.5" is fine.
    if let Some((stem, ext)) = n.rsplit_once('.') {
        let looks_like_ext = !stem.is_empty()
            && (1..=5).contains(&ext.len())
            && ext.chars().all(|c| c.is_ascii_alphanumeric())
            && ext.chars().any(|c| c.is_ascii_alphabetic());
        if looks_like_ext || ext.is_empty() {
            return Err(LibError::BadName);
        }
    }
    Ok(format!("{n}.md"))
}

impl Library {
    pub fn open(root: impl Into<PathBuf>) -> Result<Library, LibError> {
        let root = root.into();
        fs::create_dir_all(&root)?;
        Ok(Library { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn path(&self, name: &str) -> Result<(String, PathBuf), LibError> {
        let n = validate_name(name)?;
        let p = self.root.join(&n);
        Ok((n, p))
    }

    pub fn list(&self) -> Result<Vec<String>, LibError> {
        let mut v = Vec::new();
        for e in fs::read_dir(&self.root)? {
            let e = e?;
            if !e.file_type()?.is_file() {
                continue;
            }
            if let Some(n) = e.file_name().to_str() {
                if validate_name(n).is_ok()
                    && (n.to_lowercase().ends_with(".md") || n.to_lowercase().ends_with(".txt"))
                {
                    v.push(n.to_string());
                }
            }
        }
        v.sort_by_key(|s| s.to_lowercase());
        Ok(v)
    }

    pub fn read(&self, name: &str) -> Result<String, LibError> {
        let (_, p) = self.path(name)?;
        // never follow a symlink out of the library folder
        if fs::symlink_metadata(&p)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(LibError::BadName);
        }
        match fs::read(&p) {
            Ok(b) => Ok(String::from_utf8_lossy(&b).into_owned()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Err(LibError::NotFound),
            Err(e) => Err(e.into()),
        }
    }

    /// Atomic write (temp file + rename). Returns the stored name.
    pub fn write(&self, name: &str, text: &str) -> Result<String, LibError> {
        if text.len() > MAX_BYTES {
            return Err(LibError::TooLarge);
        }
        let (n, p) = self.path(name)?;
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let tmp = self.root.join(format!(".{}-{seq}.tmp", std::process::id()));
        fs::write(&tmp, text)?;
        if let Err(e) = fs::rename(&tmp, &p) {
            let _ = fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(n)
    }

    pub fn delete(&self, name: &str) -> Result<(), LibError> {
        let (_, p) = self.path(name)?;
        match fs::remove_file(p) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Err(LibError::NotFound),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(validate_name("intro").unwrap(), "intro.md");
        assert_eq!(validate_name("حلقة ١.md").unwrap(), "حلقة ١.md");
        assert_eq!(validate_name("a.TXT").unwrap(), "a.TXT");
        assert_eq!(validate_name("episode 2.5").unwrap(), "episode 2.5.md");
        for bad in [
            "", ".hidden", "../x", "a/b", "a\\b", "x.exe", "x.sh", ".md", "con\0", "a:b", "x.md/",
        ] {
            assert!(validate_name(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn roundtrip_list_delete() {
        let d = tempfile::tempdir().unwrap();
        let l = Library::open(d.path()).unwrap();
        assert_eq!(l.write("Zeta", "z").unwrap(), "Zeta.md");
        l.write("alpha.txt", "نص").unwrap();
        fs::write(d.path().join("ignored.png"), b"x").unwrap();
        fs::create_dir(d.path().join("sub.md")).unwrap();
        assert_eq!(l.list().unwrap(), vec!["alpha.txt", "Zeta.md"]);
        assert_eq!(l.read("alpha.txt").unwrap(), "نص");
        l.delete("alpha.txt").unwrap();
        assert!(matches!(l.read("alpha.txt"), Err(LibError::NotFound)));
        assert!(matches!(l.delete("alpha.txt"), Err(LibError::NotFound)));
    }

    #[test]
    fn traversal_blocked() {
        let d = tempfile::tempdir().unwrap();
        let l = Library::open(d.path().join("lib")).unwrap();
        fs::write(d.path().join("secret.md"), "s").unwrap();
        assert!(l.read("../secret.md").is_err());
        assert!(l.write("../evil.md", "x").is_err());
        assert!(!d.path().join("evil.md").exists());
    }

    #[test]
    fn size_limit() {
        let d = tempfile::tempdir().unwrap();
        let l = Library::open(d.path()).unwrap();
        let big = "x".repeat(MAX_BYTES + 1);
        assert!(matches!(l.write("big", &big), Err(LibError::TooLarge)));
    }

    #[test]
    fn invalid_utf8_is_lossy_not_error() {
        let d = tempfile::tempdir().unwrap();
        let l = Library::open(d.path()).unwrap();
        fs::write(d.path().join("b.txt"), [0xff, 0xfe, b'a']).unwrap();
        assert!(l.read("b.txt").unwrap().ends_with('a'));
    }
}
