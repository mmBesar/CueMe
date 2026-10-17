//! Wire protocol (JSON over WebSocket). The hub is a relay + state keeper;
//! the *display* owns the scroll position and streams it out.

use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Version of this protocol; bump on incompatible changes.
pub const PROTOCOL: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Display,
    Remote,
}

/// Commands the remote sends and the display executes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Cmd {
    Play,
    Pause,
    Toggle,
    /// Smoothly ease to this fraction (0..1) of the script.
    Seek {
        p: f64,
    },
    /// Held jog: v in -1..1 (fraction of max jog speed); 0 releases.
    Jog {
        v: f64,
    },
    /// Jump to the next/previous heading (dir = 1 / -1).
    Heading {
        dir: i32,
    },
    /// Jump (eased) to the Nth heading of the script, 0-based.
    GotoHeading {
        index: u32,
    },
    Top,
    Fullscreen,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ClientMsg {
    Hello {
        role: Role,
    },
    /// Partial settings patch.
    Set {
        settings: Value,
    },
    /// Replace the script text.
    Text {
        text: String,
        name: Option<String>,
    },
    /// Load a script from the library into the session.
    Load {
        name: String,
    },
    /// Save a script into the library.
    Save {
        name: String,
        text: String,
    },
    /// Ask the hub to render Markdown for a preview (answered to sender only).
    Render {
        text: String,
    },
    /// Remote -> display command.
    Cmd(Cmd),
    /// Display -> everyone: live position.
    Pos {
        p: f64,
        playing: bool,
        /// Estimated seconds to the end at the current speed.
        #[serde(default)]
        eta: Option<f64>,
    },
    /// Display -> everyone: the display changed play state on its own (keyboard).
    Playing {
        playing: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ServerMsg {
    Welcome {
        protocol: u32,
        version: String,
        id: u64,
    },
    State {
        settings: Settings,
        text: String,
        html: String,
        name: String,
        rev: u64,
    },
    Pos {
        p: f64,
        playing: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        eta: Option<f64>,
    },
    Cmd(Cmd),
    Rendered {
        html: String,
    },
    Peers {
        displays: usize,
        remotes: usize,
    },
    Library {
        files: Vec<String>,
    },
    Error {
        msg: String,
    },
    /// Heartbeat so a page can tell a dead connection from a quiet one.
    Ping,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_messages_parse() {
        let m: ClientMsg = serde_json::from_str(r#"{"t":"hello","role":"display"}"#).unwrap();
        assert!(matches!(
            m,
            ClientMsg::Hello {
                role: Role::Display
            }
        ));
        let m: ClientMsg = serde_json::from_str(r#"{"t":"cmd","cmd":"seek","p":0.5}"#).unwrap();
        assert!(matches!(m, ClientMsg::Cmd(Cmd::Seek { p }) if p == 0.5));
        let m: ClientMsg =
            serde_json::from_str(r#"{"t":"cmd","cmd":"goto_heading","index":7}"#).unwrap();
        assert!(matches!(m, ClientMsg::Cmd(Cmd::GotoHeading { index: 7 })));
        let m: ClientMsg = serde_json::from_str(r#"{"t":"cmd","cmd":"toggle"}"#).unwrap();
        assert!(matches!(m, ClientMsg::Cmd(Cmd::Toggle)));
        let m: ClientMsg = serde_json::from_str(r#"{"t":"pos","p":0.1,"playing":true}"#).unwrap();
        assert!(matches!(m, ClientMsg::Pos { playing: true, .. }));
    }

    #[test]
    fn garbage_rejected() {
        assert!(serde_json::from_str::<ClientMsg>(r#"{"t":"nope"}"#).is_err());
        assert!(serde_json::from_str::<ClientMsg>("[]").is_err());
        assert!(serde_json::from_str::<ClientMsg>(r#"{"t":"cmd","cmd":"seek"}"#).is_err());
    }

    #[test]
    fn server_roundtrip() {
        let s = serde_json::to_string(&ServerMsg::Cmd(Cmd::Jog { v: -0.5 })).unwrap();
        assert_eq!(s, r#"{"t":"cmd","cmd":"jog","v":-0.5}"#);
        let s = serde_json::to_string(&ServerMsg::Pos {
            p: 0.25,
            playing: false,
            eta: None,
        })
        .unwrap();
        assert_eq!(s, r#"{"t":"pos","p":0.25,"playing":false}"#);
    }
}
