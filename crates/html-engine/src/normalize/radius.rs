// Born-canonical radius normalization — port of lib/normalize-radius.ts.
//
// Output is byte-equal to the TS reference on the 3 starter templates; the
// regexes and decision branches mirror it exactly. Idempotent (no-op once
// `data-ol-radius` is present), structurally non-destructive.

use once_cell::sync::Lazy;
use regex::Regex;

const RADIUS_MARKER: &str = "data-ol-radius";

const CONFIG_SCRIPT: &str = concat!(
    "<script data-ol-radius>(function(){",
    "var w=window;w.tailwind=w.tailwind||{};",
    "var c=w.tailwind.config||{};var t=c.theme||{};var e=t.extend||{};",
    "e.borderRadius=Object.assign({},e.borderRadius,{",
    "sm:'var(--ol-r-sm)',DEFAULT:'var(--ol-r)',md:'var(--ol-r-md)',",
    "lg:'var(--ol-r-lg)',xl:'var(--ol-r-xl)',",
    "'2xl':'var(--ol-r-2xl)','3xl':'var(--ol-r-3xl)'});",
    "w.tailwind.config=Object.assign({},c,{theme:Object.assign({},t,",
    "{extend:Object.assign({},e)})});",
    "})();</script>"
);

const TOKENS_STYLE: &str = concat!(
    "<style data-ol-radius>:root{",
    "--ol-r-scale:1;",
    "--ol-r-sm:calc(0.125rem*var(--ol-r-scale));",
    "--ol-r:calc(0.25rem*var(--ol-r-scale));",
    "--ol-r-md:calc(0.375rem*var(--ol-r-scale));",
    "--ol-r-lg:calc(0.5rem*var(--ol-r-scale));",
    "--ol-r-xl:calc(0.75rem*var(--ol-r-scale));",
    "--ol-r-2xl:calc(1rem*var(--ol-r-scale));",
    "--ol-r-3xl:calc(1.5rem*var(--ol-r-scale));",
    "}</style>"
);

static STYLE_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)(<style\b[^>]*>)(.*?)(</style>)").unwrap());
static BORDER_RADIUS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)border-radius\s*:\s*([^;}]+)").unwrap());
static HEAD_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</head>").unwrap());
static TOKEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^(\d*\.?\d+)(px|rem|em)$").unwrap());
static VAR_OR_CALC_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)var\(|calc\(").unwrap());

fn scale_radius_token(tok: &str) -> String {
    let caps = match TOKEN_RE.captures(tok) {
        Some(c) => c,
        None => return tok.to_string(),
    };
    let n: f64 = match caps[1].parse() {
        Ok(v) => v,
        Err(_) => return tok.to_string(),
    };
    let unit_lower = caps[2].to_ascii_lowercase();
    if n == 0.0 {
        return tok.to_string();
    }
    if unit_lower == "px" && n >= 100.0 {
        return tok.to_string();
    }
    format!("calc({} * var(--ol-r-scale))", tok)
}

fn rewrite_css(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut last = 0;
    for cap in BORDER_RADIUS_RE.captures_iter(css) {
        let m = cap.get(0).unwrap();
        out.push_str(&css[last..m.start()]);
        let value = cap.get(1).unwrap().as_str();
        let decl = m.as_str();
        if VAR_OR_CALC_RE.is_match(value) {
            out.push_str(decl);
        } else {
            let toks: Vec<&str> = value.split_whitespace().collect();
            let scaled: Vec<String> = toks.iter().map(|t| scale_radius_token(t)).collect();
            if scaled.iter().zip(toks.iter()).all(|(s, t)| s == t) {
                out.push_str(decl);
            } else {
                out.push_str("border-radius: ");
                out.push_str(&scaled.join(" "));
            }
        }
        last = m.end();
    }
    out.push_str(&css[last..]);
    out
}

fn scale_literal_radii(html: &str) -> String {
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

/// Port of `normalizeRadius` in lib/normalize-radius.ts. Output is byte-equal
/// to the TS reference on the starter templates; idempotent on the marker.
pub fn normalize_radius(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    if html.contains(RADIUS_MARKER) {
        return html.to_string();
    }
    let scaled = scale_literal_radii(html);
    let injection = String::from(CONFIG_SCRIPT) + TOKENS_STYLE;
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
