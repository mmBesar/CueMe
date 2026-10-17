//! PIN generation and comparison.

use rand::RngExt;

/// Random PIN: 3 digits (000-999). It only has to stop a casual neighbour on a
/// private network; wrong guesses are rate-limited by the hub.
pub fn generate_pin() -> String {
    let mut rng = rand::rng();
    format!("{:03}", rng.random_range(0..1000))
}

/// Is this a PIN in the format we generate (exactly 3 digits)?
pub fn is_generated_format(p: &str) -> bool {
    p.len() == 3 && p.bytes().all(|c| c.is_ascii_digit())
}

/// Constant-time comparison, ASCII case-insensitive so a typed PIN is forgiving.
pub fn pin_matches(expected: &str, given: &str) -> bool {
    let a = expected.to_ascii_uppercase();
    let b = given.trim().to_ascii_uppercase();
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_shape() {
        for _ in 0..200 {
            assert!(is_generated_format(&generate_pin()));
        }
        // not always the same
        let first = generate_pin();
        assert!((0..200).any(|_| generate_pin() != first));
    }

    #[test]
    fn format_check() {
        assert!(is_generated_format("007"));
        assert!(!is_generated_format("7"));
        assert!(!is_generated_format("1234"));
        assert!(!is_generated_format("ABCD2345")); // old 8-character format
        assert!(!is_generated_format("12a"));
    }

    #[test]
    fn matching() {
        assert!(pin_matches("ABCD2345", "abcd2345"));
        assert!(pin_matches("042", " 042 "));
        assert!(!pin_matches("042", "043"));
        assert!(!pin_matches("042", "04"));
        assert!(!pin_matches("042", ""));
    }
}
