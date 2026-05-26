// Born-canonical display-font normalization — port of lib/normalize-font.ts.
// Identify the display font (non-body, non-mono, non-generic), hoist it
// behind --ol-font-display, rewrite its declarations to var(), inject the
// Google Fonts <link> + the token <style>. Byte-equal vs TS on 3 starter
// templates; idempotent on data-ol-font; no-op on one-font pages.

use once_cell::sync::Lazy;
use regex::Regex;

const FONT_MARKER: &str = "data-ol-font";

const DISPLAY_FONTS_LINK: &str = concat!(
    "<link data-ol-font rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?",
    "family=Inter:wght@400;500;600;700&amp;",
    "family=Geist:wght@400;500;600;700&amp;",
    "family=Manrope:wght@400;500;600;700&amp;",
    "family=Plus+Jakarta+Sans:wght@400;500;600;700&amp;",
    "family=Outfit:wght@400;500;600;700&amp;",
    "family=Space+Grotesk:wght@400;500;600;700&amp;",
    "family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&amp;",
    "family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&amp;",
    "family=Crimson+Pro:wght@400;500;600;700&amp;",
    "family=Playfair+Display:wght@400;500;600;700&amp;",
    "family=DM+Serif+Display&amp;",
    "family=Instrument+Serif&amp;display=swap\">"
);

static GENERIC: &[&str] = &[
    "serif",
    "sans-serif",
    "monospace",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "ui-rounded",
    "cursive",
    "fantasy",
    "inherit",
    "initial",
    "unset",
];

static BODY_RULE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\s,{}>])body\s*\{[^}]*font-family\s*:\s*([^;}]+)").unwrap()
});
static FONT_FAMILY_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)font-family\s*:\s*([^;}]+)").unwrap());
static MONO_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bmono(?:space)?\b").unwrap());
static SERIF_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bserif\b").unwrap());
static SANS_SERIF_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)sans-serif").unwrap());
static HEAD_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</head>").unwrap());

fn strip_outer_quotes(s: &str) -> &str {
    let bytes = s.as_bytes();
    let mut start = 0;
    let mut end = bytes.len();
    while start < end && (bytes[start] == b'\'' || bytes[start] == b'"') {
        start += 1;
    }
    while end > start && (bytes[end - 1] == b'\'' || bytes[end - 1] == b'"') {
        end -= 1;
    }
    &s[start..end]
}

fn family_key(value: &str) -> String {
    let first = value.split(',').next().unwrap_or("");
    strip_outer_quotes(first.trim()).to_ascii_lowercase()
}

fn first_family_preserved(value: &str) -> String {
    let first = value.split(',').next().unwrap_or("");
    strip_outer_quotes(first.trim()).to_string()
}

fn is_generic(key: &str) -> bool {
    GENERIC.contains(&key)
}

/// Port of `normalizeFont` in lib/normalize-font.ts.
pub fn normalize_font(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    if html.contains(FONT_MARKER) {
        return html.to_string();
    }

    let body_key = BODY_RULE_RE
        .captures(html)
        .and_then(|c| c.get(1).map(|m| family_key(m.as_str())))
        .unwrap_or_default();

    let values: Vec<String> = FONT_FAMILY_RE
        .captures_iter(html)
        .map(|c| c.get(1).unwrap().as_str().trim().to_string())
        .collect();

    let mut display_name = String::new();
    for value in &values {
        if MONO_RE.is_match(value) {
            continue;
        }
        let key = family_key(value);
        if key.is_empty() || key == body_key || is_generic(&key) {
            continue;
        }
        display_name = first_family_preserved(value);
        break;
    }
    if display_name.is_empty() {
        return html.to_string();
    }

    let display_key = display_name.to_ascii_lowercase();
    let is_serif = values.iter().any(|v| {
        family_key(v) == display_key && SERIF_RE.is_match(v) && !SANS_SERIF_RE.is_match(v)
    });
    let fallback = if is_serif { "serif" } else { "sans-serif" };

    // Rewrite every font-family declaration whose first family matches the
    // display font: parts = value.split(","); parts[0] = " var(...)"; etc.
    let mut out = String::with_capacity(html.len() + 256);
    let mut last = 0;
    for cap in FONT_FAMILY_RE.captures_iter(html) {
        let whole = cap.get(0).unwrap();
        let value = cap.get(1).unwrap().as_str();
        out.push_str(&html[last..whole.start()]);
        if family_key(value) == display_key {
            let mut parts: Vec<String> = value.split(',').map(|s| s.to_string()).collect();
            parts[0] = " var(--ol-font-display)".to_string();
            out.push_str("font-family:");
            out.push_str(&parts.join(","));
        } else {
            out.push_str(whole.as_str());
        }
        last = whole.end();
    }
    out.push_str(&html[last..]);

    let token_style = format!(
        "<style data-ol-font>:root{{--ol-font-display:'{}',{};}}</style>",
        display_name, fallback
    );
    let injection = String::from(DISPLAY_FONTS_LINK) + &token_style;

    match HEAD_CLOSE_RE.find(&out) {
        Some(m) => {
            let mut final_out = String::with_capacity(out.len() + injection.len());
            final_out.push_str(&out[..m.start()]);
            final_out.push_str(&injection);
            final_out.push_str(&out[m.start()..]);
            final_out
        }
        None => out + &injection,
    }
}
