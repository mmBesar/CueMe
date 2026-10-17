//! Markdown -> safe HTML for the prompter.
//!
//! * Raw HTML in the source is rendered as literal text (no script injection).
//! * Link / image URLs are limited to http, https, mailto and relative paths.
//! * Every block element gets `dir="auto"` so Arabic and English paragraphs
//!   (and mixed ones) each lay out in their own natural direction.

use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};

fn safe_url(u: &str) -> bool {
    let t = u.trim().to_ascii_lowercase();
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("mailto:") {
        return true;
    }
    // relative or fragment, but no scheme at all
    !t.contains(':') || t.starts_with('#')
}

/// Longest run of `>` at the start of any line (block-quote depth).
fn max_quote_depth(src: &str) -> usize {
    let mut best = 0;
    for line in src.lines() {
        let mut d = 0;
        for c in line.chars() {
            match c {
                '>' => d += 1,
                ' ' | '\t' => {}
                _ => break,
            }
        }
        best = best.max(d);
    }
    best
}

fn escape_plain(src: &str) -> String {
    let mut out = String::new();
    for para in src.split("\n\n") {
        if para.trim().is_empty() {
            continue;
        }
        out.push_str("<p dir=\"auto\">");
        for (i, line) in para.lines().enumerate() {
            if i > 0 {
                out.push_str("<br>");
            }
            for c in line.chars() {
                match c {
                    '&' => out.push_str("&amp;"),
                    '<' => out.push_str("&lt;"),
                    '>' => out.push_str("&gt;"),
                    '"' => out.push_str("&quot;"),
                    _ => out.push(c),
                }
            }
        }
        out.push_str("</p>\n");
    }
    out
}

/// Markdown to safe HTML. Pathological input (huge block-quote nesting, output
/// far larger than the input) is shown as plain text instead, so one message
/// cannot make the hub burn CPU or memory.
pub fn render(src: &str) -> String {
    if max_quote_depth(src) > 40 {
        return escape_plain(src);
    }
    let out = render_markdown(src);
    if out.len() > src.len().saturating_mul(4) + 65_536 {
        return escape_plain(src);
    }
    out
}

fn render_markdown(src: &str) -> String {
    let opts = Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_SMART_PUNCTUATION;
    // Unsafe images are dropped (their alt text stays as plain text).
    let mut image_unsafe: Vec<bool> = Vec::new();
    let parser = Parser::new_ext(src, opts).filter_map(|ev| match ev {
        Event::Html(s) | Event::InlineHtml(s) => Some(Event::Text(s)),
        Event::Start(Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        }) if !safe_url(&dest_url) => Some(Event::Start(Tag::Link {
            link_type,
            dest_url: "#".into(),
            title,
            id,
        })),
        Event::Start(Tag::Image { ref dest_url, .. }) => {
            let bad = !safe_url(dest_url);
            image_unsafe.push(bad);
            if bad {
                None
            } else {
                Some(ev)
            }
        }
        Event::End(TagEnd::Image) => {
            if image_unsafe.pop().unwrap_or(false) {
                None
            } else {
                Some(Event::End(TagEnd::Image))
            }
        }
        other => Some(other),
    });
    let mut out = String::with_capacity(src.len() * 2);
    html::push_html(&mut out, parser);
    add_dir_auto(&out)
}

/// pulldown-cmark emits block tags without attributes, so a plain replace is
/// exact. Text content is HTML-escaped by the renderer, so a literal
/// "<p>" in user text appears as "&lt;p&gt;" and is never matched.
fn add_dir_auto(h: &str) -> String {
    let mut s = h.to_string();
    for tag in [
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "blockquote",
        "td",
        "th",
    ] {
        s = s.replace(&format!("<{tag}>"), &format!("<{tag} dir=\"auto\">"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arabic_and_english() {
        let h = render("# مرحبا\n\nهذا **نص** عربي with English\n\n- بند\n- item");
        assert!(h.contains("<h1 dir=\"auto\">مرحبا</h1>"));
        assert!(h.contains("<p dir=\"auto\">هذا <strong>نص</strong> عربي with English</p>"));
        assert!(h.contains("<li dir=\"auto\">بند</li>"));
    }

    #[test]
    fn raw_html_is_neutralised() {
        let h = render("<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>");
        assert!(!h.contains("<script"));
        assert!(!h.contains("<img"));
        assert!(h.contains("&lt;script&gt;"));
    }

    #[test]
    fn bad_urls_are_neutralised() {
        let h = render(
            "[x](javascript:alert(1)) [y](JaVaScRiPt:alert(1)) ![i](data:text/html;base64,AAAA)",
        );
        assert!(!h.to_lowercase().contains("javascript:"));
        assert!(!h.contains("data:"));
        assert!(!h.contains("<img"), "unsafe image must not become an <img>");
        assert!(
            h.contains(">i<") || h.ends_with("i</p>\n"),
            "alt text kept: {h}"
        );
        let ok = render("[a](https://example.com) [b](#top) [c](page.md)");
        assert!(ok.contains("https://example.com"));
        assert!(ok.contains("href=\"#top\""));
        assert!(ok.contains("href=\"page.md\""));
    }

    #[test]
    fn literal_tag_text_not_double_processed() {
        let h = render("use `<p>` here");
        assert!(h.contains("&lt;p&gt;"));
    }

    #[test]
    fn empty_ok() {
        assert_eq!(render(""), "");
    }

    #[test]
    fn pathological_nesting_is_plain_text() {
        let evil = ">".repeat(200_000) + " x";
        let h = render(&evil);
        assert!(h.len() < evil.len() * 5, "output stays small: {}", h.len());
        assert!(!h.contains("<blockquote"));
        assert!(h.contains("&gt;"));
        let ok = render("> quote\n\ntext");
        assert!(ok.contains("<blockquote"));
    }
}
