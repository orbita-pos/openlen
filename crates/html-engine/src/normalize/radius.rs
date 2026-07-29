// Born-canonical radius normalization — port of lib/normalize-radius.ts.
//
// Output is byte-equal to the TS reference on the 3 starter templates; the
// regexes and decision branches mirror it exactly. Idempotent (no-op once
// `data-ol-radius` is present), structurally non-destructive.

use once_cell::sync::Lazy;
use regex::Regex;

const SCRIPT_TAG: &str = "<script data-ol-radius";
const STYLE_TAG: &str = "<style data-ol-radius";

pub(crate) const CONFIG_SCRIPT: &str = concat!(
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
/// to the TS reference on the starter templates.
///
/// Idempotencia por PIEZA, no por marcador a secas (bug 2026-07-29): el
/// sanitizer mata el <script data-ol-radius> pero el <style data-ol-radius>
/// sobrevive, y el chequeo viejo (`contains("data-ol-radius")`) veía el style
/// y creía "ya normalizado" — el script jamás volvía y los sliders Tier-3
/// dejaban de mover las utilities. Script y style se comprueban por separado
/// y solo se inyecta lo que falta; el rewrite de literales corre únicamente
/// en la primera normalización (cuando no hay style).
pub fn normalize_radius(html: &str) -> String {
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
        scale_literal_radii(html)
    };
    let mut injection = String::new();
    if !has_script {
        injection.push_str(CONFIG_SCRIPT);
    }
    if !has_style {
        injection.push_str(TOKENS_STYLE);
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

    const DOC: &str = "<html><head><script src=\"https://cdn.tailwindcss.com\"></script><style>.card{border-radius:12px}</style></head><body><div class=\"rounded-lg\"></div></body></html>";

    #[test]
    fn full_pass_injects_script_and_style() {
        let out = normalize_radius(DOC);
        assert!(out.contains("<script data-ol-radius>"));
        assert!(out.contains("<style data-ol-radius>"));
        assert!(out.contains("calc(12px * var(--ol-r-scale))"));
    }

    #[test]
    fn idempotent_when_both_present() {
        let once = normalize_radius(DOC);
        assert_eq!(normalize_radius(&once), once);
    }

    // Bug 2026-07-29: el sanitizer mata el <script data-ol-radius> pero el
    // <style> sobrevive; el chequeo por marcador único creía "ya normalizado"
    // y el script jamás volvía.
    #[test]
    fn reinjects_script_when_only_style_survives() {
        let once = normalize_radius(DOC);
        let stripped = once.replace(CONFIG_SCRIPT, "");
        assert!(!stripped.contains("<script data-ol-radius"));
        let healed = normalize_radius(&stripped);
        assert!(healed.contains("<script data-ol-radius>"));
        // exactamente el script de vuelta — sin duplicar el style ni tocar nada más
        assert_eq!(healed.replace(CONFIG_SCRIPT, ""), stripped);
        assert_eq!(healed.matches("<style data-ol-radius").count(), 1);
    }

    #[test]
    fn repair_is_idempotent() {
        let once = normalize_radius(DOC);
        let stripped = once.replace(CONFIG_SCRIPT, "");
        let healed = normalize_radius(&stripped);
        assert_eq!(normalize_radius(&healed), healed);
        assert_eq!(healed.matches("<script data-ol-radius").count(), 1);
    }
}
