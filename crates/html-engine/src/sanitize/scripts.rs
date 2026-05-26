// Strip `<script>` tags unless `src` matches a whitelisted CDN. Port of the
// first step in lib/style-match/autofill/sanitize.ts. Inline scripts and
// arbitrary remote scripts both get removed — the only thing we allow is the
// Tailwind CDN script because every template relies on it and we control the
// URL.

use lol_html::{element, rewrite_str, RewriteStrSettings};

use crate::error::EngineError;
use crate::sanitize::RemovedCounts;

const ALLOWED_SCRIPT_SRCS: &[&str] = &[
    "https://cdn.tailwindcss.com",
    "https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,line-clamp",
];

/// Returns the rewritten HTML plus the count of `<script>` tags removed.
pub fn strip_scripts(html: &str, removed: &mut RemovedCounts) -> Result<String, EngineError> {
    if html.is_empty() {
        return Ok(String::new());
    }
    let counter = std::cell::Cell::new(0u32);
    let out = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("script", |el| {
                let src = el.get_attribute("src").unwrap_or_default();
                let trimmed = src.trim();
                if !trimmed.is_empty() && ALLOWED_SCRIPT_SRCS.contains(&trimmed) {
                    return Ok(());
                }
                el.remove();
                counter.set(counter.get() + 1);
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| EngineError::Rewrite(e.to_string()))?;
    removed.scripts += counter.get();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_passes_through() {
        let mut r = RemovedCounts::default();
        assert_eq!(strip_scripts("", &mut r).unwrap(), "");
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn inline_script_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_scripts("<p>x</p><script>alert(1)</script>", &mut r).unwrap();
        assert!(!out.contains("alert"));
        assert!(!out.contains("<script"));
        assert_eq!(r.scripts, 1);
    }

    #[test]
    fn whitelisted_tailwind_kept() {
        let mut r = RemovedCounts::default();
        let html = "<script src=\"https://cdn.tailwindcss.com\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("cdn.tailwindcss.com"));
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn whitelisted_tailwind_with_plugins_kept() {
        let mut r = RemovedCounts::default();
        let html = "<script src=\"https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,line-clamp\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("plugins=forms"));
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn non_whitelisted_src_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_scripts(
            "<script src=\"https://evil.example/x.js\"></script>",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("evil.example"));
        assert_eq!(r.scripts, 1);
    }

    #[test]
    fn empty_src_treated_as_inline() {
        // <script src=""> is inline-equivalent — strip it.
        let mut r = RemovedCounts::default();
        let out = strip_scripts("<script src=\"\">bad()</script>", &mut r).unwrap();
        assert!(!out.contains("<script"));
        assert_eq!(r.scripts, 1);
    }

    #[test]
    fn multiple_scripts_counted() {
        let mut r = RemovedCounts::default();
        let html = "<script>a()</script><p>x</p><script>b()</script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(!out.contains("<script"));
        assert_eq!(r.scripts, 2);
    }

    #[test]
    fn clean_html_byte_equal() {
        // No scripts to strip ⇒ output is identical to input.
        let mut r = RemovedCounts::default();
        let html = "<div class=\"foo\"><p>hello</p></div>";
        assert_eq!(strip_scripts(html, &mut r).unwrap(), html);
        assert_eq!(r.scripts, 0);
    }
}
