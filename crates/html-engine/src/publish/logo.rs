// Logo / favicon extraction + injection for publish-time HTML.
//
// `extract_logo` is read-only — walks the head looking for the page's
// declared favicon and falls back to the og:image. Used by resolveProjectLogo
// to auto-detect a logo the first time a project publishes.
//
// `inject_logo` replaces existing rel="icon" / "shortcut" links with a new
// one pointing at the project's resolved logo URL and conditionally injects
// an og:image fallback. apple-touch-icon / mask-icon are deliberately left
// alone — they use different rel tokens and have their own resolution rules.

use kuchikiki::traits::TendrilSink;

use super::{escape_attr, parse_fragment_children, serialize_doc};

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

/// Bake the per-project logo into the published HTML's `<head>`:
///
///   1. Strip every existing `<link rel>` whose rel tokens are EXACTLY
///      `icon` or `shortcut` (matches `icon`, `shortcut`, `shortcut icon`).
///      `apple-touch-icon` and `mask-icon` survive — their rel tokens are
///      multi-char strings that don't equal either of those literals.
///   2. Append `<link rel="icon" href="<logo_url>" />` at the end of `<head>`.
///   3. If no `<meta property="og:image">` exists in the document AND the
///      `logo_url` is not a `data:` URI, also append
///      `<meta property="og:image" content="<logo_url>" />`. data: URIs are
///      valid favicons but social crawlers (Facebook / X / LinkedIn) won't
///      render them, so we leave og:image alone in that case rather than
///      ship a broken share preview.
///
/// Soft-fails to the original HTML when the input is empty, the logo URL
/// is empty, or the document is so malformed that kuchikiki can't find a
/// `<head>` even after html5ever's auto-insertion. The publish pipeline
/// wraps this in a try-equivalent so the page still publishes regardless.
pub fn inject_logo(html: &str, logo_url: &str) -> String {
    if html.is_empty() || logo_url.is_empty() {
        return html.to_string();
    }
    let doc = kuchikiki::parse_html().one(html);

    // html5ever's tree builder is spec-conformant and synthesizes <head> for
    // any input that reaches us, so this match should always take the Ok arm
    // in practice. Defensive bail on the impossible case anyway.
    let head = match doc.select_first("head") {
        Ok(h) => h.as_node().clone(),
        Err(_) => return html.to_string(),
    };

    // 1. Remove existing rel="icon" / rel="shortcut" link elements. EXACT
    // token match — apple-touch-icon / mask-icon / icon-shortcut survive.
    let to_remove: Vec<_> = match head.select("link[rel]") {
        Ok(it) => it
            .filter(|link| {
                let attrs = link.attributes.borrow();
                let rel = attrs
                    .get("rel")
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                if rel.is_empty() {
                    return false;
                }
                rel.split_whitespace()
                    .any(|t| t == "icon" || t == "shortcut")
            })
            .collect(),
        Err(_) => vec![],
    };
    for link in to_remove {
        link.as_node().detach();
    }

    // 2. Append new <link rel="icon" href="...">.
    let link_html = format!(r#"<link rel="icon" href="{}" />"#, escape_attr(logo_url));
    for node in parse_fragment_children(&link_html) {
        head.append(node);
    }

    // 3. Conditionally append og:image.
    let has_og_image = doc.select_first(r#"meta[property="og:image"]"#).is_ok();
    if !has_og_image && !is_data_uri(logo_url) {
        let meta_html = format!(
            r#"<meta property="og:image" content="{}" />"#,
            escape_attr(logo_url)
        );
        for node in parse_fragment_children(&meta_html) {
            head.append(node);
        }
    }

    serialize_doc(&doc)
}

fn is_data_uri(href: &str) -> bool {
    href.get(..5)
        .map(|s| s.eq_ignore_ascii_case("data:"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── extract_logo ────────────────────────────────────────────────────────

    #[test]
    fn extract_empty_input_none() {
        assert_eq!(extract_logo(""), None);
    }

    #[test]
    fn extract_no_match_none() {
        let html = "<html><head></head><body><p>x</p></body></html>";
        assert_eq!(extract_logo(html), None);
    }

    #[test]
    fn extract_picks_first_link_icon_in_document_order() {
        let html = r#"<html><head>
            <link rel="icon" href="/favicon.ico">
            <link rel="apple-touch-icon" href="/apple-icon.png">
        </head></html>"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/favicon.ico");
        assert!(!got.is_data_uri);
    }

    #[test]
    fn extract_picks_shortcut_icon() {
        let html = r#"<link rel="shortcut icon" href="/fav.png">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.png");
    }

    #[test]
    fn extract_picks_apple_touch_icon_when_only_match() {
        let html = r#"<link rel="apple-touch-icon" href="/apple.png">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/apple.png");
    }

    #[test]
    fn extract_picks_mask_icon_when_only_match() {
        let html = r#"<link rel="mask-icon" href="/mask.svg">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/mask.svg");
    }

    #[test]
    fn extract_link_wins_over_og_image_when_both_present() {
        let html = r#"<html><head>
            <meta property="og:image" content="/og.jpg">
            <link rel="icon" href="/fav.ico">
        </head></html>"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.ico");
    }

    #[test]
    fn extract_og_image_fallback_when_no_icon_link() {
        let html = r#"<meta property="og:image" content="/og.jpg">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/og.jpg");
    }

    #[test]
    fn extract_detects_data_uri_href() {
        let html = r#"<link rel="icon" href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">"#;
        let got = extract_logo(html).expect("expected match");
        assert!(got.is_data_uri);
        assert!(got.href.starts_with("data:"));
    }

    #[test]
    fn extract_detects_data_uri_case_insensitive() {
        let html = r#"<link rel="icon" href="DATA:image/png;base64,XX">"#;
        let got = extract_logo(html).expect("expected match");
        assert!(got.is_data_uri);
    }

    #[test]
    fn extract_ignores_empty_href_falls_through_to_next() {
        let html = r#"<html><head>
            <link rel="icon" href="">
            <link rel="icon" href="/fav.png">
        </head></html>"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.png");
    }

    #[test]
    fn extract_ignores_whitespace_only_href() {
        let html = r#"<html><head>
            <link rel="icon" href="   ">
            <meta property="og:image" content="/og.jpg">
        </head></html>"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/og.jpg");
    }

    #[test]
    fn extract_trims_whitespace_on_returned_href() {
        let html = r#"<link rel="icon" href="  /fav.png  ">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.png");
    }

    #[test]
    fn extract_case_insensitive_rel_token_matching() {
        let html = r#"<link rel="ICON" href="/fav.png">"#;
        let got = extract_logo(html).expect("expected match");
        assert_eq!(got.href, "/fav.png");
    }

    // ─── inject_logo ─────────────────────────────────────────────────────────

    #[test]
    fn inject_empty_html_unchanged() {
        assert_eq!(inject_logo("", "/logo.png"), "");
    }

    #[test]
    fn inject_empty_logo_unchanged() {
        let html = "<html><head></head><body></body></html>";
        assert_eq!(inject_logo(html, ""), html);
    }

    #[test]
    fn inject_adds_link_when_none_present() {
        let html = "<html><head></head><body></body></html>";
        let out = inject_logo(html, "/logo.png");
        assert!(out.contains(r#"<link rel="icon" href="/logo.png""#));
    }

    #[test]
    fn inject_replaces_existing_icon_link() {
        let html = r#"<html><head><link rel="icon" href="/old.png"></head></html>"#;
        let out = inject_logo(html, "/new.png");
        assert!(!out.contains("/old.png"));
        assert!(out.contains(r#"<link rel="icon" href="/new.png""#));
    }

    #[test]
    fn inject_replaces_shortcut_icon() {
        let html = r#"<html><head><link rel="shortcut icon" href="/old.ico"></head></html>"#;
        let out = inject_logo(html, "/new.png");
        assert!(!out.contains("/old.ico"));
        assert!(out.contains(r#"<link rel="icon" href="/new.png""#));
    }

    #[test]
    fn inject_replaces_bare_shortcut_token() {
        let html = r#"<html><head><link rel="shortcut" href="/old.ico"></head></html>"#;
        let out = inject_logo(html, "/new.png");
        assert!(!out.contains("/old.ico"));
    }

    #[test]
    fn inject_preserves_apple_touch_icon() {
        let html = r#"<html><head>
            <link rel="icon" href="/old.png">
            <link rel="apple-touch-icon" href="/apple.png">
        </head></html>"#;
        let out = inject_logo(html, "/new.png");
        assert!(out.contains(r#"rel="apple-touch-icon""#));
        assert!(out.contains("/apple.png"));
        assert!(!out.contains("/old.png"));
    }

    #[test]
    fn inject_preserves_mask_icon() {
        let html = r#"<html><head>
            <link rel="icon" href="/old.png">
            <link rel="mask-icon" href="/mask.svg">
        </head></html>"#;
        let out = inject_logo(html, "/new.png");
        assert!(out.contains(r#"rel="mask-icon""#));
        assert!(out.contains("/mask.svg"));
    }

    #[test]
    fn inject_adds_og_image_when_absent_and_not_data_uri() {
        let html = "<html><head></head><body></body></html>";
        let out = inject_logo(html, "/logo.png");
        assert!(out.contains(r#"<meta property="og:image" content="/logo.png""#));
    }

    #[test]
    fn inject_does_not_overwrite_existing_og_image() {
        let html = r#"<html><head><meta property="og:image" content="/user.jpg"></head></html>"#;
        let out = inject_logo(html, "/logo.png");
        // User's og:image is preserved.
        assert!(out.contains("/user.jpg"));
        // No second og:image was appended.
        assert_eq!(out.matches(r#"property="og:image""#).count(), 1);
    }

    #[test]
    fn inject_skips_og_image_when_logo_is_data_uri() {
        let html = "<html><head></head><body></body></html>";
        let logo = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
        let out = inject_logo(html, logo);
        // Favicon still gets the data: URI.
        assert!(out.contains(r#"<link rel="icon" href="data:image/svg+xml"#));
        // But og:image is intentionally skipped (social crawlers can't fetch data: URIs).
        assert!(!out.contains(r#"property="og:image""#));
    }

    #[test]
    fn inject_idempotent_after_first_application() {
        // The first call appends both the icon link AND og:image at end-of-head.
        // Subsequent calls remove and re-append the icon link (so it lands after
        // any other head children) while skipping og:image (already present), so
        // the order is "og:image first, then link" from N=2 onwards. Stable from
        // there — that's what callers can rely on for repeated publishes.
        let html = "<html><head></head><body></body></html>";
        let twice = inject_logo(&inject_logo(html, "/logo.png"), "/logo.png");
        let thrice = inject_logo(&twice, "/logo.png");
        assert_eq!(twice, thrice);
    }

    #[test]
    fn inject_escapes_ampersand_in_url() {
        let html = "<html><head></head><body></body></html>";
        let out = inject_logo(html, "/img.png?a=1&b=2");
        // Raw `&` must be entity-encoded in the attribute value.
        assert!(out.contains("/img.png?a=1&amp;b=2"));
        assert!(!out.contains("/img.png?a=1&b=2"));
    }

    #[test]
    fn inject_escapes_quote_in_url() {
        let html = "<html><head></head><body></body></html>";
        let out = inject_logo(html, r#"/path"with"quote.png"#);
        assert!(out.contains(r#"&quot;with&quot;"#));
    }

    #[test]
    fn inject_into_headless_input_works() {
        // No explicit <head>; html5ever synthesizes one on parse so the
        // injection still lands.
        let html = "<body><p>x</p></body>";
        let out = inject_logo(html, "/logo.png");
        assert!(out.contains(r#"<link rel="icon" href="/logo.png""#));
        assert!(out.contains(r#"<meta property="og:image" content="/logo.png""#));
    }
}
