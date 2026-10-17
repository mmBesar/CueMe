//! cue-core: the platform-independent brain of CueMe.
//!
//! Everything here is plain Rust with no networking and no UI, so it is
//! unit-testable and identical on every platform.

pub mod auth;
pub mod library;
pub mod markdown;
pub mod protocol;
pub mod settings;
