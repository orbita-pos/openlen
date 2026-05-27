// Logo / favicon extraction + injection for publish-time HTML.
//
// `extract_logo` is read-only — walks the head looking for the page's
// declared favicon and falls back to the og:image. Used by resolveProjectLogo
// to auto-detect a logo the first time a project publishes.
//
// `inject_logo` (added in F1.5 B2) replaces icons + injects og:image when
// the project carries an explicit per-project logo URL.

use kuchikiki::traits::TendrilSink;

/// A logo / favicon URL recovered from a publish-ready HTML document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedLogo {
    /// Href exactly as it appears in the source (data: / absolute / relative).
    /// Already trimmed of surrounding whitespace.
    pub href: String,
    /// True when `href` starts with the `data:` scheme (case-insensitive).
    pub is_data_uri: bool,
}

/// Pick the page's best-candidate favicon / logo URL by scanning, in order:
///   1. Any `<link rel>` whose rel tokens *contain* "icon" (catches `icon`,
///      `shortcut icon`, `apple-touch-icon`, …) — the first match's `href` wins.
///   2. The `<meta property="og:image">` content as a fallback.
///
/// Returns `None` when the document is empty or nothing matched.
pub fn extract_logo(html: &str) -> Option<ExtractedLogo> {
    if html.is_empty() {
        return None;
    }
    let doc = kuchikiki::parse_html().one(html);

    // 1. <link rel> with any token containing "icon".
    if let Ok(links) = doc.select("link[rel]") {
        for link in links {
            let attrs = link.attributes.borrow();
            let rel = attrs.get("rel").unwrap_or("").to_ascii_lowercase();
            if !rel.split_whitespace().any(|t| t.contains("icon")) {
                continue;
            }
            if let Some(href) = attrs.get("href") {
                let trimmed = href.trim();
                if !trimmed.is_empty() {
                    return Some(ExtractedLogo {
                        href: trimmed.to_string(),
                        is_data_uri: is_data_uri(trimmed),
                    });
                }
            }
        }
    }

    // 2. og:image fallback.
    if let Ok(metas) = doc.select(r#"meta[property="og:image"]"#) {
        for m in metas {
            let attrs = m.attributes.borrow();
            if let Some(content) = attrs.get("content") {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    return Some(ExtractedLogo {
                        href: trimmed.to_string(),
                        is_data_uri: is_data_uri(trimmed),
                    });
                }
            }
        }
    }

    None
}

fn is_data_uri(href: &str) -> bool {
    href.get(..5)
        .map(|s| s.eq_ignore_ascii_case("data:"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_none() {
        assert_eq!(extract_logo(""), None);
    }

    #[test]
    fn no_match_none() {
        let html = "<html><head></head><body><p>x</p></body></html>";
        assert_eq!(extract_logo(html), None);
    }

    #[test]
    fn picks_first_link_icon_in_document_order() {
        let html = r#"<html><head>
            <link rel="icon" href="/favicon.ico">
            <link rel="apple-touch-icon" href="/apple-icon.png">
        </head></html>"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/favicon.ico");
        assert!(!got.is_data_uri);
    }

    #[test]
    fn picks_shortcut_icon() {
        let html = r#"<link rel="shortcut icon" href="/fav.png">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.png");
    }

    #[test]
    fn picks_apple_touch_icon_when_only_match() {
        let html = r#"<link rel="apple-touch-icon" href="/apple.png">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/apple.png");
    }

    #[test]
    fn picks_mask_icon_when_only_match() {
        let html = r#"<link rel="mask-icon" href="/mask.svg">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/mask.svg");
    }

    #[test]
    fn link_wins_over_og_image_when_both_present() {
        let html = r#"<html><head>
            <meta property="og:image" content="/og.jpg">
            <link rel="icon" href="/fav.ico">
        </head></html>"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.ico");
    }

    #[test]
    fn og_image_fallback_when_no_icon_link() {
        let html = r#"<meta property="og:image" content="/og.jpg">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/og.jpg");
    }

    #[test]
    fn detects_data_uri_href() {
        let html = r#"<link rel="icon" href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">"#;
        let got = extract_logo(html).expect("expected match");
        assert!(got.is_data_uri);
        assert!(got.href.starts_with("data:"));
    }

    #[test]
    fn detects_data_uri_case_insensitive() {
        let html = r#"<link rel="icon" href="DATA:image/png;base64,XX">"#;
        let got = extract_logo(html).expect("expected match");
        assert!(got.is_data_uri);
    }

    #[test]
    fn ignores_empty_href_falls_through_to_next() {
        let html = r#"<html><head>
            <link rel="icon" href="">
            <link rel="icon" href="/fav.png">
        </head></html>"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.png");
    }

    #[test]
    fn ignores_whitespace_only_href() {
        let html = r#"<html><head>
            <link rel="icon" href="   ">
            <meta property="og:image" content="/og.jpg">
        </head></html>"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/og.jpg");
    }

    #[test]
    fn trims_whitespace_on_returned_href() {
        let html = r#"<link rel="icon" href="  /fav.png  ">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.png");
    }

    #[test]
    fn case_insensitive_rel_token_matching() {
        let html = r#"<link rel="ICON" href="/fav.png">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.png");
    }
}
