// Born-canonical type-scale normalization — port of lib/normalize-type.ts.
// Injection (Tailwind fontSize override + :root tokens) plus a literal
// `font-size:` declaration rewrite. Byte-equal vs TS on 3 starter
// templates; idempotent on data-ol-type.

use once_cell::sync::Lazy;
use regex::Regex;

const TYPE_MARKER: &str = "data-ol-type";

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

static INJECTION: Lazy<String> = Lazy::new(|| {
    let size_entries: Vec<String> = SIZES
        .iter()
        .map(|(k, _, _)| format!("'{}':['var(--ol-text-{})','var(--ol-lh-{})']", k, k, k))
        .collect();
    let config_script = format!(
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
    );

    let tokens_body: String = SIZES
        .iter()
        .map(|(k, s, lh)| {
            format!(
                "--ol-text-{}:calc({}*var(--ol-text-scale));--ol-lh-{}:calc({}*var(--ol-text-scale));",
                k, s, k, lh
            )
        })
        .collect();
    let tokens_style = format!(
        "<style data-ol-type>:root{{--ol-text-scale:1;{}}}</style>",
        tokens_body
    );

    config_script + &tokens_style
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

/// Port of `normalizeType` in lib/normalize-type.ts.
pub fn normalize_type(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    if html.contains(TYPE_MARKER) {
        return html.to_string();
    }
    let scaled = scale_literal_font_sizes(html);
    let injection: &str = &INJECTION;
    match HEAD_CLOSE_RE.find(&scaled) {
        Some(m) => {
            let mut out = String::with_capacity(scaled.len() + injection.len());
            out.push_str(&scaled[..m.start()]);
            out.push_str(injection);
            out.push_str(&scaled[m.start()..]);
            out
        }
        None => scaled + injection,
    }
}
