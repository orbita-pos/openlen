// Born-canonical type-scale normalization — port of lib/normalize-type.ts.
// Injection (Tailwind fontSize override + :root tokens) plus a literal
// `font-size:` declaration rewrite. Byte-equal vs TS on 3 starter
// templates; idempotent on data-ol-type.

use once_cell::sync::Lazy;
use regex::Regex;

const SCRIPT_TAG: &str = "<script data-ol-type";
const STYLE_TAG: &str = "<style data-ol-type";

// (key, size, line-height) — mirrors the TS array.
const SIZES: &[(&str, &str, &str)] = &[
    ("xs", "0.75rem", "1rem"),
    ("sm", "0.875rem", "1.25rem"),
    ("base", "1rem", "1.5rem"),
    ("lg", "1.125rem", "1.75rem"),
    ("xl", "1.25rem", "1.75rem"),
    ("2xl", "1.5rem", "2rem"),
    ("3xl", "1.875rem", "2.25rem"),
    ("4xl", "2.25rem", "2.5rem"),
    ("5xl", "3rem", "1"),
    ("6xl", "3.75rem", "1"),
    ("7xl", "4.5rem", "1"),
    ("8xl", "6rem", "1"),
    ("9xl", "8rem", "1"),
];

pub(crate) static CONFIG_SCRIPT: Lazy<String> = Lazy::new(|| {
    let size_entries: Vec<String> = SIZES
        .iter()
        .map(|(k, _, _)| format!("'{}':['var(--ol-text-{})','var(--ol-lh-{})']", k, k, k))
        .collect();
    format!(
        concat!(
            "<script data-ol-type>(function(){{",
            "var w=window;w.tailwind=w.tailwind||{{}};",
            "var c=w.tailwind.config||{{}};var t=c.theme||{{}};var e=t.extend||{{}};",
            "e.fontSize=Object.assign({{}},e.fontSize,{{{}}});",
            "w.tailwind.config=Object.assign({{}},c,{{theme:Object.assign({{}},t,",
            "{{extend:Object.assign({{}},e)}})}});",
            "}})();</script>"
        ),
        size_entries.join(",")
    )
});

static TOKENS_STYLE: Lazy<String> = Lazy::new(|| {
    let tokens_body: String = SIZES
        .iter()
        .map(|(k, s, lh)| {
            format!(
                "--ol-text-{}:calc({}*var(--ol-text-scale));--ol-lh-{}:calc({}*var(--ol-text-scale));",
                k, s, k, lh
            )
        })
        .collect();
    format!(
        "<style data-ol-type>:root{{--ol-text-scale:1;{}}}</style>",
        tokens_body
    )
});

static STYLE_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)(<style\b[^>]*>)(.*?)(</style>)").unwrap());
static FONT_SIZE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)font-size\s*:\s*([^;}]+)").unwrap());
static HEAD_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</head>").unwrap());
static TOKEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^(\d*\.?\d+)(px|rem|em)$").unwrap());
static VAR_CALC_CLAMP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)var\(|calc\(|clamp\(").unwrap());

fn scale_font_token(tok: &str) -> String {
    let caps = match TOKEN_RE.captures(tok) {
        Some(c) => c,
        None => return tok.to_string(),
    };
    let n: f64 = match caps[1].parse() {
        Ok(v) => v,
        Err(_) => return tok.to_string(),
    };
    if n == 0.0 {
        return tok.to_string();
    }
    format!("calc({} * var(--ol-text-scale))", tok)
}

fn rewrite_css(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut last = 0;
    for cap in FONT_SIZE_RE.captures_iter(css) {
        let m = cap.get(0).unwrap();
        out.push_str(&css[last..m.start()]);
        let value = cap.get(1).unwrap().as_str();
        let decl = m.as_str();
        let v = value.trim();
        if VAR_CALC_CLAMP_RE.is_match(v) {
            out.push_str(decl);
        } else {
            let scaled = scale_font_token(v);
            if scaled == v {
                out.push_str(decl);
            } else {
                out.push_str("font-size: ");
                out.push_str(&scaled);
            }
        }
        last = m.end();
    }
    out.push_str(&css[last..]);
    out
}

fn scale_literal_font_sizes(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut last = 0;
    for cap in STYLE_BLOCK_RE.captures_iter(html) {
        let m = cap.get(0).unwrap();
        out.push_str(&html[last..m.start()]);
        out.push_str(cap.get(1).unwrap().as_str());
        out.push_str(&rewrite_css(cap.get(2).unwrap().as_str()));
        out.push_str(cap.get(3).unwrap().as_str());
        last = m.end();
    }
    out.push_str(&html[last..]);
    out
}

/// Port of `normalizeType` in lib/normalize-type.ts. Idempotencia por PIEZA
/// (script/style separados) — ver el comentario en radius.rs (bug 2026-07-29).
/// El rewrite de font-size literal corre solo en la primera normalización.
pub fn normalize_type(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let has_script = html.contains(SCRIPT_TAG);
    let has_style = html.contains(STYLE_TAG);
    if has_script && has_style {
        return html.to_string();
    }
    let scaled = if has_style {
        html.to_string()
    } else {
        scale_literal_font_sizes(html)
    };
    let mut injection = String::new();
    if !has_script {
        injection.push_str(&CONFIG_SCRIPT);
    }
    if !has_style {
        injection.push_str(&TOKENS_STYLE);
    }
    match HEAD_CLOSE_RE.find(&scaled) {
        Some(m) => {
            let mut out = String::with_capacity(scaled.len() + injection.len());
            out.push_str(&scaled[..m.start()]);
            out.push_str(&injection);
            out.push_str(&scaled[m.start()..]);
            out
        }
        None => scaled + &injection,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "<html><head><script src=\"https://cdn.tailwindcss.com\"></script><style>h1{font-size:40px}</style></head><body><p class=\"text-xl\"></p></body></html>";

    fn strip_tag(html: &str, open: &str) -> String {
        let start = html.find(open).expect("open tag");
        let end = html[start..].find("</script>").expect("close tag") + start + "</script>".len();
        format!("{}{}", &html[..start], &html[end..])
    }

    #[test]
    fn reinjects_script_when_only_style_survives() {
        let once = normalize_type(DOC);
        let stripped = strip_tag(&once, "<script data-ol-type>");
        assert!(!stripped.contains("<script data-ol-type"));
        let healed = normalize_type(&stripped);
        assert!(healed.contains("<script data-ol-type>"));
        assert_eq!(healed.matches("<style data-ol-type").count(), 1);
        // el rewrite de font-size literal NO se re-corre: bytes idénticos + script
        assert_eq!(strip_tag(&healed, "<script data-ol-type>"), stripped);
    }

    #[test]
    fn repair_is_idempotent() {
        let once = normalize_type(DOC);
        let stripped = strip_tag(&once, "<script data-ol-type>");
        let healed = normalize_type(&stripped);
        assert_eq!(normalize_type(&healed), healed);
        assert_eq!(healed.matches("<script data-ol-type").count(), 1);
    }
}
