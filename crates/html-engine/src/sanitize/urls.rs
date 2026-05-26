// Strip URL-bearing attributes whose value uses a dangerous scheme. Port of
// step 4 in lib/style-match/autofill/sanitize.ts. Six attribute names are
// considered URL-bearing: href, src, action, formaction, background, ping.
// Three scheme families are rejected: javascript: / vbscript: (any element,
// any case) and the data: subschemes that can execute (text/html, and
// image/svg+xml when it embeds a script).
//
// We don't try to "fix" or rewrite the value — we drop the attribute entirely
// so the browser silently no-ops the link. This matches the TS reference
// (removeAttr in cheerio) and avoids the second-order problem of trying to
// normalize a hostile URL.

use lol_html::{element, rewrite_str, RewriteStrSettings};
use once_cell::sync::Lazy;
use regex::Regex;

use crate::error::EngineError;
use crate::sanitize::RemovedCounts;

const URL_ATTRS: &[&str] = &["href", "src", "action", "formaction", "background", "ping"];

// Matches lib/style-match/autofill/sanitize.ts DANGEROUS_URL_SCHEME exactly:
//   ^\s*(javascript|vbscript|data:text/html|data:image/svg\+xml.*script)
// Case insensitive. Leading whitespace tolerated (browsers ignore it before
// the scheme). `.*` on the SVG branch catches both `data:image/svg+xml,...
// <script>...` and base64-encoded payloads where the literal substring
// `script` appears in the decoded preamble.
static DANGEROUS_URL_SCHEME: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)^\s*(javascript|vbscript|data:text/html|data:image/svg\+xml.*script)")
        .expect("hard-coded regex must compile")
});

fn is_dangerous_url(value: &str) -> bool {
    DANGEROUS_URL_SCHEME.is_match(value)
}

pub fn strip_dangerous_urls(
    html: &str,
    removed: &mut RemovedCounts,
) -> Result<String, EngineError> {
    if html.is_empty() {
        return Ok(String::new());
    }
    let counter = std::cell::Cell::new(0u32);
    let out = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("*", |el| {
                // Collect attrs to remove first; mutating during the
                // attributes() borrow is a runtime error.
                let to_remove: Vec<String> = el
                    .attributes()
                    .iter()
                    .filter_map(|a| {
                        let name = a.name();
                        if !URL_ATTRS.iter().any(|u| u.eq_ignore_ascii_case(&name)) {
                            return None;
                        }
                        if is_dangerous_url(&a.value()) {
                            Some(name)
                        } else {
                            None
                        }
                    })
                    .collect();
                for n in to_remove {
                    el.remove_attribute(&n);
                    counter.set(counter.get() + 1);
                }
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| EngineError::Rewrite(e.to_string()))?;
    removed.dangerous_urls += counter.get();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_href_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_urls("<a href=\"javascript:alert(1)\">x</a>", &mut r).unwrap();
        assert!(!out.contains("javascript:"));
        assert_eq!(r.dangerous_urls, 1);
    }

    #[test]
    fn javascript_mixed_case_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_urls("<a href=\"JaVaScRiPt:alert(1)\">x</a>", &mut r).unwrap();
        assert!(!out.to_lowercase().contains("javascript:"));
        assert_eq!(r.dangerous_urls, 1);
    }

    #[test]
    fn javascript_with_leading_whitespace_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_urls("<a href=\"   javascript:alert(1)\">x</a>", &mut r).unwrap();
        assert!(!out.contains("javascript"));
        assert_eq!(r.dangerous_urls, 1);
    }

    #[test]
    fn vbscript_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_urls("<a href=\"vbscript:msgbox(1)\">x</a>", &mut r).unwrap();
        assert!(!out.contains("vbscript"));
        assert_eq!(r.dangerous_urls, 1);
    }

    #[test]
    fn data_text_html_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_urls(
            "<iframe src=\"data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;\"></iframe>",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("data:text/html"));
        assert_eq!(r.dangerous_urls, 1);
    }

    #[test]
    fn data_svg_with_script_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_urls(
            "<img src=\"data:image/svg+xml;utf8,<svg><script>alert(1)</script></svg>\">",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("data:image/svg+xml"));
        assert_eq!(r.dangerous_urls, 1);
    }

    #[test]
    fn data_svg_without_script_kept() {
        let mut r = RemovedCounts::default();
        let html = "<img src=\"data:image/svg+xml;utf8,<svg><circle r=\\\"5\\\"/></svg>\">";
        let out = strip_dangerous_urls(html, &mut r).unwrap();
        assert!(out.contains("data:image/svg+xml"));
        assert_eq!(r.dangerous_urls, 0);
    }

    #[test]
    fn formaction_javascript_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_urls(
            "<button formaction=\"javascript:alert(1)\">submit</button>",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("javascript"));
        assert!(!out.contains("formaction"));
        assert_eq!(r.dangerous_urls, 1);
    }

    #[test]
    fn ping_javascript_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_urls("<a ping=\"javascript:alert(1)\" href=\"/y\">x</a>", &mut r)
            .unwrap();
        assert!(!out.contains("ping="));
        assert!(out.contains("href=\"/y\""));
        assert_eq!(r.dangerous_urls, 1);
    }

    #[test]
    fn safe_https_url_kept() {
        let mut r = RemovedCounts::default();
        let html = "<a href=\"https://example.com\">x</a>";
        assert_eq!(strip_dangerous_urls(html, &mut r).unwrap(), html);
        assert_eq!(r.dangerous_urls, 0);
    }

    #[test]
    fn mailto_kept() {
        let mut r = RemovedCounts::default();
        let html = "<a href=\"mailto:hi@example.com\">x</a>";
        assert_eq!(strip_dangerous_urls(html, &mut r).unwrap(), html);
    }

    #[test]
    fn fragment_kept() {
        let mut r = RemovedCounts::default();
        let html = "<a href=\"#section\">x</a>";
        assert_eq!(strip_dangerous_urls(html, &mut r).unwrap(), html);
    }

    #[test]
    fn empty_input_passes_through() {
        let mut r = RemovedCounts::default();
        assert_eq!(strip_dangerous_urls("", &mut r).unwrap(), "");
    }

    #[test]
    fn data_image_png_kept() {
        // data:image/png base64 is a normal embed pattern.
        let mut r = RemovedCounts::default();
        let html = "<img src=\"data:image/png;base64,iVBORw0KGg==\">";
        assert_eq!(strip_dangerous_urls(html, &mut r).unwrap(), html);
    }
}
