//! Prompter settings with strict validation. Every value that arrives from a
//! network peer goes through [`Settings::merged`], which clamps numbers and
//! rejects malformed colours, so a bad client can never put the display in an
//! unusable state.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Text size in px (16..=400).
    pub font_size: f64,
    /// Scroll speed in lines per minute (0..=240).
    pub speed: f64,
    pub flip_x: bool,
    pub flip_y: bool,
    /// `#rrggbb`
    pub text_color: String,
    /// `#rrggbb`
    pub bg_color: String,
    /// Text column width in percent of the screen (20..=100).
    pub width: f64,
    /// How much the text outside the focus band is dimmed, percent (0..=90).
    pub dim: f64,
    /// Fading focus band on/off.
    pub focus: bool,
    /// Vertical position of the cue line, percent from top (10..=90).
    pub focus_pos: f64,
    pub bold: bool,
    /// Seconds of countdown before playback starts (0..=10).
    pub countdown: f64,
    /// Ask for fullscreen when playback starts (needs a key press or click).
    pub auto_fullscreen: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            font_size: 64.0,
            speed: 20.0,
            flip_x: false,
            flip_y: false,
            text_color: "#ffffff".into(),
            bg_color: "#000000".into(),
            width: 90.0,
            dim: 60.0,
            focus: true,
            focus_pos: 40.0,
            bold: false,
            countdown: 0.0,
            auto_fullscreen: false,
        }
    }
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v.is_nan() {
        lo
    } else {
        v.max(lo).min(hi)
    }
}

pub fn is_hex_color(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[0] == b'#' && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

impl Settings {
    /// Clamp every field into its legal range and repair bad colours.
    pub fn sanitized(mut self) -> Settings {
        let d = Settings::default();
        self.font_size = clamp(self.font_size, 16.0, 400.0);
        self.speed = clamp(self.speed, 0.0, 240.0);
        self.width = clamp(self.width, 20.0, 100.0);
        self.dim = clamp(self.dim, 0.0, 90.0);
        self.focus_pos = clamp(self.focus_pos, 10.0, 90.0);
        self.countdown = clamp(self.countdown, 0.0, 10.0).round();
        if !is_hex_color(&self.text_color) {
            self.text_color = d.text_color;
        }
        if !is_hex_color(&self.bg_color) {
            self.bg_color = d.bg_color;
        }
        self
    }

    /// Apply a partial JSON patch (unknown keys ignored, wrong-typed keys
    /// ignored) and return the sanitized result.
    pub fn merged(&self, patch: &Value) -> Settings {
        let mut base = match serde_json::to_value(self) {
            Ok(Value::Object(m)) => m,
            _ => Map::new(),
        };
        if let Value::Object(p) = patch {
            for (k, v) in p {
                if let Some(old) = base.get(k) {
                    let same_kind = matches!(
                        (old, v),
                        (Value::Number(_), Value::Number(_))
                            | (Value::Bool(_), Value::Bool(_))
                            | (Value::String(_), Value::String(_))
                    );
                    if same_kind {
                        base.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        serde_json::from_value::<Settings>(Value::Object(base))
            .unwrap_or_else(|_| self.clone())
            .sanitized()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_are_valid() {
        let d = Settings::default();
        assert_eq!(d.clone().sanitized(), d);
    }

    #[test]
    fn patch_clamps_and_ignores_garbage() {
        let s = Settings::default().merged(&json!({
            "font_size": 99999, "speed": -5, "width": 5,
            "text_color": "red", "bg_color": "#112233",
            "flip_x": "yes", "nonsense": 1
        }));
        assert_eq!(s.font_size, 400.0);
        assert_eq!(s.speed, 0.0);
        assert_eq!(s.width, 20.0);
        assert_eq!(s.text_color, "#ffffff"); // string but not a colour -> repaired
        assert_eq!(s.bg_color, "#112233");
        assert!(!s.flip_x); // wrong type ignored
    }

    #[test]
    fn non_object_patch_is_noop() {
        let d = Settings::default();
        assert_eq!(d.merged(&json!([1, 2, 3])), d);
        assert_eq!(d.merged(&json!(null)), d);
    }

    #[test]
    fn color_check() {
        assert!(is_hex_color("#aBc123"));
        assert!(!is_hex_color("#abc"));
        assert!(!is_hex_color("url(x)"));
        assert!(!is_hex_color("#gggggg"));
    }
}
