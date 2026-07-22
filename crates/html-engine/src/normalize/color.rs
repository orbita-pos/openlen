// Born-canonical color palette normalization — port of lib/normalize-color.ts.
// Hoists semantic roles (bg / surface / fg / border) onto canonical --ol-*
// tokens by chaining the page's own role-named tokens through var(), with a
// `body { … }` fallback for bg + fg. Byte-equal vs TS on 3 starter templates;
// idempotent on data-ol-color.

use once_cell::sync::Lazy;
use regex::Regex;

const COLOR_MARKER: &str = "data-ol-color";

struct Role {
    var_name: &'static str,
    names: &'static [&'static str],
}

const ROLES: &[Role] = &[
    Role {
        var_name: "--ol-bg",
        names: &["bg", "background", "page", "canvas"],
    },
    Role {
        var_name: "--ol-surface",
        names: &["surface", "card", "panel", "elevated"],
    },
    Role {
        var_name: "--ol-fg",
        names: &["fg", "foreground", "text", "ink"],
    },
    Role {
        var_name: "--ol-border",
        names: &["border", "line", "hairline", "rule", "divider", "stroke"],
    },
];

static ROOT_BLOCK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i):root\s*\{([^}]*)\}").unwrap());
static ROOT_DECL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)--([a-z0-9-]+)\s*:\s*([^;}]+);?").unwrap());
static HEX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^#([0-9a-f]{3}|[0-9a-f]{6})$").unwrap());
static RGB_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})").unwrap());
static RGBA_ALPHA_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*([0-9]*\.?[0-9]+)\s*\)$")
        .unwrap()
});
static BODY_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)(?:^|[\s,{}>])(body\s*\{[^}]*\})").unwrap());
static BG_DECL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(background-color|background)\s*:\s*([^;}]+)").unwrap());
static COLOR_DECL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)color\s*:\s*([^;}]+)").unwrap());
static HEAD_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</head>").unwrap());

fn to_hex(value: &str) -> Option<String> {
    let v = value.trim();
    // A translucent color keeps its alpha verbatim — hexifying
    // rgba(255,255,255,0.06) flattens a 6% hairline into a solid white line
    // on every dark clone (bug Kiri, 2026-07-22). Opaque rgba (alpha = 1)
    // still canonicalizes to hex below.
    if let Some(caps) = RGBA_ALPHA_RE.captures(v) {
        let alpha = caps[1].parse::<f32>().unwrap_or(1.0);
        if alpha < 1.0 {
            return Some(v.to_string());
        }
    }
    if let Some(caps) = HEX_RE.captures(v) {
        let h = caps.get(1).unwrap().as_str();
        let expanded = if h.len() == 3 {
            let mut s = String::with_capacity(6);
            for c in h.chars() {
                s.push(c);
                s.push(c);
            }
            s
        } else {
            h.to_string()
        };
        return Some(format!("#{}", expanded.to_ascii_lowercase()));
    }
    if let Some(caps) = RGB_RE.captures(v) {
        let r = caps[1].parse::<u32>().ok()?.min(255) as u8;
        let g = caps[2].parse::<u32>().ok()?.min(255) as u8;
        let b = caps[3].parse::<u32>().ok()?.min(255) as u8;
        return Some(format!("#{:02x}{:02x}{:02x}", r, g, b));
    }
    None
}

/// Find the first `color\s*:\s*[^;}]+` match in `s` whose preceding byte is
/// not `-` (the TS regex uses negative lookbehind `(?<!-)`, which the regex
/// crate lacks). Returns (whole-match start, whole-match end, value-str).
fn first_color_decl(s: &str) -> Option<(usize, usize, String)> {
    for cap in COLOR_DECL_RE.captures_iter(s) {
        let m = cap.get(0).unwrap();
        let prev = m.start().checked_sub(1).and_then(|i| s.as_bytes().get(i));
        if matches!(prev, Some(b'-')) {
            continue;
        }
        let value = cap.get(1).unwrap().as_str().to_string();
        return Some((m.start(), m.end(), value));
    }
    None
}

/// Port of `normalizeColor` in lib/normalize-color.ts.
pub fn normalize_color(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    if html.contains(COLOR_MARKER) {
        return html.to_string();
    }

    let mut out = html.to_string();
    let mut found: std::collections::HashMap<&'static str, String> =
        std::collections::HashMap::new();

    // :root tokens.
    let root_body: Option<String> = ROOT_BLOCK_RE
        .captures(html)
        .map(|c| c.get(1).unwrap().as_str().to_string());
    if let Some(body) = root_body {
        for cap in ROOT_DECL_RE.captures_iter(&body) {
            let name = cap.get(1).unwrap().as_str().to_ascii_lowercase();
            let value = cap.get(2).unwrap().as_str();
            let Some(hex) = to_hex(value) else { continue };
            for role in ROLES {
                if found.contains_key(role.var_name) {
                    continue;
                }
                if role.names.contains(&name.as_str()) {
                    found.insert(role.var_name, hex.clone());
                    let whole = cap.get(0).unwrap().as_str();
                    let replacement = format!(
                        "--{}: var({});",
                        cap.get(1).unwrap().as_str(),
                        role.var_name
                    );
                    out = out.replacen(whole, &replacement, 1);
                    break;
                }
            }
        }
    }

    // Body-rule fallback for bg + fg.
    if !found.contains_key("--ol-bg") || !found.contains_key("--ol-fg") {
        if let Some(body_cap) = BODY_BLOCK_RE.captures(&out) {
            let body_block = body_cap.get(1).unwrap().as_str().to_string();
            let mut block = body_block.clone();
            if !found.contains_key("--ol-bg") {
                if let Some(bg) = BG_DECL_RE.captures(&block) {
                    let whole = bg.get(0).unwrap().as_str().to_string();
                    let prop = bg.get(1).unwrap().as_str().to_string();
                    let value = bg.get(2).unwrap().as_str();
                    if let Some(hex) = to_hex(value) {
                        found.insert("--ol-bg", hex);
                        let replacement = format!("{}: var(--ol-bg)", prop);
                        block = block.replacen(&whole, &replacement, 1);
                    }
                }
            }
            if !found.contains_key("--ol-fg") {
                if let Some((start, end, value)) = first_color_decl(&block) {
                    if let Some(hex) = to_hex(&value) {
                        found.insert("--ol-fg", hex);
                        let whole: String = block[start..end].to_string();
                        let replacement = "color: var(--ol-fg)".to_string();
                        block = block.replacen(&whole, &replacement, 1);
                    }
                }
            }
            if block != body_block {
                out = out.replacen(&body_block, &block, 1);
            }
        }
    }

    let entries: String = ROLES
        .iter()
        .map(|r| match found.get(r.var_name) {
            Some(hex) => format!("{}:{};", r.var_name, hex),
            None => String::new(),
        })
        .collect();
    if entries.is_empty() {
        return html.to_string();
    }

    let style = format!("<style data-ol-color>:root{{{}}}</style>", entries);
    match HEAD_CLOSE_RE.find(&out) {
        Some(m) => {
            let mut final_out = String::with_capacity(out.len() + style.len());
            final_out.push_str(&out[..m.start()]);
            final_out.push_str(&style);
            final_out.push_str(&out[m.start()..]);
            final_out
        }
        None => out + &style,
    }
}
