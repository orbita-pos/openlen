// Born-canonical accent normalization — port of lib/normalize-accent.ts.
// Identifies the brand accent (named-or-by-chroma) from :root tokens +
// tailwind.config color map, then rewrites its hex/rgb occurrences across
// <style>, inline style="", Tailwind `[#hex]` arbitrary values, the
// tailwind.config script, and the --*-r RGB-triplet pattern. Byte-equal
// vs TS on 3 starter templates; idempotent on data-ol-accent.

use once_cell::sync::Lazy;
use regex::Regex;

const ACCENT_MARKER: &str = "data-ol-accent";
const ACCENT_NAMES: &[&str] = &["accent", "brand", "primary"];
const MIN_ACCENT_CHROMA: f64 = 0.2;

static ROOT_BLOCK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i):root\s*\{([^}]*)\}").unwrap());
static ROOT_DECL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)--([a-z0-9-]+)\s*:\s*([^;}]+);?").unwrap());
static SCRIPT_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<script\b[^>]*>(.*?)</script>").unwrap());
static CONFIG_COLOR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"['"]?([A-Za-z0-9_-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]"#).unwrap()
});
static STYLE_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)(<style\b[^>]*>)(.*?)(</style>)").unwrap());
static INLINE_STYLE_DQ_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(\sstyle\s*=\s*")([^"]*)(")"#).unwrap());
static INLINE_STYLE_SQ_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(\sstyle\s*=\s*')([^']*)(')").unwrap());
static HEX_PARSE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^#([0-9a-f]{3}|[0-9a-f]{6})$").unwrap());
static HEAD_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</head>").unwrap());

#[derive(Debug, Clone, Copy)]
struct Rgb {
    r: u8,
    g: u8,
    b: u8,
}

fn parse_hex(value: &str) -> Option<Rgb> {
    let caps = HEX_PARSE_RE.captures(value.trim())?;
    let h = caps.get(1).unwrap().as_str();
    let h = if h.len() == 3 {
        let mut s = String::with_capacity(6);
        for c in h.chars() {
            s.push(c);
            s.push(c);
        }
        s
    } else {
        h.to_string()
    };
    let r = u8::from_str_radix(&h[0..2], 16).ok()?;
    let g = u8::from_str_radix(&h[2..4], 16).ok()?;
    let b = u8::from_str_radix(&h[4..6], 16).ok()?;
    Some(Rgb { r, g, b })
}

fn normalize_hex(rgb: Rgb) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb.r, rgb.g, rgb.b)
}

fn accent_score(c: Rgb) -> f64 {
    let mx = c.r.max(c.g).max(c.b) as f64 / 255.0;
    let mn = c.r.min(c.g).min(c.b) as f64 / 255.0;
    let lightness = (mx + mn) / 2.0;
    if !(0.12..=0.9).contains(&lightness) {
        return 0.0;
    }
    mx - mn
}

struct Candidate {
    name: String,
    value: String,
}

#[derive(Debug, Clone)]
struct AccentToken {
    hex: String,
    rgb: Rgb,
}

fn collect_candidates(html: &str) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = Vec::new();
    if let Some(root) = ROOT_BLOCK_RE.captures(html) {
        let body = root.get(1).unwrap().as_str();
        for cap in ROOT_DECL_RE.captures_iter(body) {
            let name = cap.get(1).unwrap().as_str().to_ascii_lowercase();
            let value = cap.get(2).unwrap().as_str().trim().to_string();
            out.push(Candidate { name, value });
        }
    }
    for cap in SCRIPT_BLOCK_RE.captures_iter(html) {
        let body = cap.get(1).unwrap().as_str();
        if !body.contains("tailwind.config") {
            continue;
        }
        for c in CONFIG_COLOR_RE.captures_iter(body) {
            let name = c.get(1).unwrap().as_str().to_ascii_lowercase();
            let value = c.get(2).unwrap().as_str().to_string();
            out.push(Candidate { name, value });
        }
    }
    out
}

fn find_accent(candidates: &[Candidate]) -> Option<AccentToken> {
    let mut named: Option<AccentToken> = None;
    let mut best: Option<AccentToken> = None;
    let mut best_score = MIN_ACCENT_CHROMA;
    for cand in candidates {
        let Some(rgb) = parse_hex(&cand.value) else {
            continue;
        };
        let hex = normalize_hex(rgb);
        let token = AccentToken {
            hex: hex.clone(),
            rgb,
        };
        if ACCENT_NAMES.contains(&cand.name.as_str()) && named.is_none() {
            named = Some(token.clone());
        }
        let score = accent_score(rgb);
        if score > best_score {
            best_score = score;
            best = Some(token);
        }
    }
    named.or(best)
}

fn hex_forms(hex: &str) -> Vec<String> {
    // hex is "#rrggbb" lowercased; forms[0] = "rrggbb", optionally + "rgb".
    let h = hex.trim_start_matches('#').to_ascii_lowercase();
    let bytes = h.as_bytes();
    let mut forms = vec![h.clone()];
    if bytes.len() == 6 && bytes[0] == bytes[1] && bytes[2] == bytes[3] && bytes[4] == bytes[5] {
        forms.push(format!(
            "{}{}{}",
            bytes[0] as char, bytes[2] as char, bytes[4] as char
        ));
    }
    forms
}

fn rewrite_css(css: &str, hex_re: &Regex, rgb_re: &Regex) -> String {
    // Hex pass — `#hex` not followed by a hex digit (manual lookahead since
    // the regex crate doesn't have zero-width assertions beyond \b).
    let mut after_hex = String::with_capacity(css.len());
    let mut last = 0;
    for m in hex_re.find_iter(css) {
        after_hex.push_str(&css[last..m.start()]);
        let next = css.as_bytes().get(m.end());
        if matches!(next, Some(c) if c.is_ascii_hexdigit()) {
            after_hex.push_str(m.as_str());
        } else {
            after_hex.push_str("var(--ol-accent)");
        }
        last = m.end();
    }
    after_hex.push_str(&css[last..]);

    // rgb() / rgba() pass.
    let mut out = String::with_capacity(after_hex.len());
    let mut last = 0;
    for cap in rgb_re.captures_iter(&after_hex) {
        let m = cap.get(0).unwrap();
        out.push_str(&after_hex[last..m.start()]);
        match cap.get(1) {
            Some(alpha) => {
                out.push_str("rgba(var(--ol-accent-r), ");
                out.push_str(alpha.as_str());
                out.push(')');
            }
            None => {
                out.push_str("rgb(var(--ol-accent-r))");
            }
        }
        last = m.end();
    }
    out.push_str(&after_hex[last..]);
    out
}

fn rewrite_style_blocks(html: &str, hex_re: &Regex, rgb_re: &Regex) -> String {
    let mut out = String::with_capacity(html.len());
    let mut last = 0;
    for cap in STYLE_BLOCK_RE.captures_iter(html) {
        let m = cap.get(0).unwrap();
        out.push_str(&html[last..m.start()]);
        out.push_str(cap.get(1).unwrap().as_str());
        out.push_str(&rewrite_css(cap.get(2).unwrap().as_str(), hex_re, rgb_re));
        out.push_str(cap.get(3).unwrap().as_str());
        last = m.end();
    }
    out.push_str(&html[last..]);
    out
}

fn rewrite_inline_styles(html: &str, re: &Regex, hex_re: &Regex, rgb_re: &Regex) -> String {
    let mut out = String::with_capacity(html.len());
    let mut last = 0;
    for cap in re.captures_iter(html) {
        let m = cap.get(0).unwrap();
        out.push_str(&html[last..m.start()]);
        out.push_str(cap.get(1).unwrap().as_str());
        out.push_str(&rewrite_css(cap.get(2).unwrap().as_str(), hex_re, rgb_re));
        out.push_str(cap.get(3).unwrap().as_str());
        last = m.end();
    }
    out.push_str(&html[last..]);
    out
}

fn rewrite_tailwind_brackets(html: &str, forms: &[String]) -> String {
    let pat = format!(r"(?i)\[#(?:{})\]", forms.join("|"));
    let re = Regex::new(&pat).unwrap();
    re.replace_all(html, "[color:var(--ol-accent)]")
        .into_owned()
}

fn rewrite_config_script(html: &str, hex_re: &Regex) -> String {
    let mut out = String::with_capacity(html.len());
    let mut last = 0;
    for cap in SCRIPT_BLOCK_RE.captures_iter(html) {
        let m = cap.get(0).unwrap();
        out.push_str(&html[last..m.start()]);
        let body = cap.get(1).unwrap().as_str();
        if body.contains("tailwind.config") {
            // Reconstruct the script: open tag + rewritten body + close tag.
            // The capture is on the body only; we need open/close tags from
            // the full match by slicing around the body match.
            let full = m.as_str();
            let body_start_rel = full.find(body).unwrap_or(0);
            let body_end_rel = body_start_rel + body.len();
            out.push_str(&full[..body_start_rel]);
            // Apply hex rewrite to body with not-hex-followed semantics.
            let rewritten = rewrite_hex_only(body, hex_re);
            out.push_str(&rewritten);
            out.push_str(&full[body_end_rel..]);
        } else {
            out.push_str(m.as_str());
        }
        last = m.end();
    }
    out.push_str(&html[last..]);
    out
}

fn rewrite_hex_only(s: &str, hex_re: &Regex) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for m in hex_re.find_iter(s) {
        out.push_str(&s[last..m.start()]);
        let next = s.as_bytes().get(m.end());
        if matches!(next, Some(c) if c.is_ascii_hexdigit()) {
            out.push_str(m.as_str());
        } else {
            out.push_str("var(--ol-accent)");
        }
        last = m.end();
    }
    out.push_str(&s[last..]);
    out
}

fn rewrite_rgb_triplet_token(html: &str, rgb: Rgb) -> String {
    let pat = format!(
        r"(?i)(--[a-z0-9-]+\s*:\s*){}\s*,\s*{}\s*,\s*{}\b",
        rgb.r, rgb.g, rgb.b
    );
    let re = Regex::new(&pat).unwrap();
    re.replace_all(html, "${1}var(--ol-accent-r)").into_owned()
}

/// Port of `normalizeAccent` in lib/normalize-accent.ts.
pub fn normalize_accent(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    if html.contains(ACCENT_MARKER) {
        return html.to_string();
    }
    let Some(accent) = find_accent(&collect_candidates(html)) else {
        return html.to_string();
    };

    let rgb = accent.rgb;
    let forms = hex_forms(&accent.hex);
    let hex_re = Regex::new(&format!(r"(?i)#(?:{})", forms.join("|"))).unwrap();
    let rgb_re = Regex::new(&format!(
        r"(?i)rgba?\(\s*{}\s*,\s*{}\s*,\s*{}\s*(?:,\s*([^)]+?)\s*)?\)",
        rgb.r, rgb.g, rgb.b
    ))
    .unwrap();

    let mut out = html.to_string();
    out = rewrite_style_blocks(&out, &hex_re, &rgb_re);
    out = rewrite_inline_styles(&out, &INLINE_STYLE_DQ_RE, &hex_re, &rgb_re);
    out = rewrite_inline_styles(&out, &INLINE_STYLE_SQ_RE, &hex_re, &rgb_re);
    out = rewrite_tailwind_brackets(&out, &forms);
    out = rewrite_config_script(&out, &hex_re);
    out = rewrite_rgb_triplet_token(&out, rgb);

    let token_style = format!(
        "<style data-ol-accent>:root{{--ol-accent:{};--ol-accent-r:{},{},{};}}</style>",
        accent.hex, rgb.r, rgb.g, rgb.b
    );
    match HEAD_CLOSE_RE.find(&out) {
        Some(m) => {
            let mut final_out = String::with_capacity(out.len() + token_style.len());
            final_out.push_str(&out[..m.start()]);
            final_out.push_str(&token_style);
            final_out.push_str(&out[m.start()..]);
            final_out
        }
        None => out + &token_style,
    }
}
