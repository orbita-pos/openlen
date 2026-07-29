// Born-canonical spacing (density) normalization — port of
// lib/normalize-space.ts. Pure injection (no CSS rewrite): marker check,
// then INJECTION before </head>. Byte-equal to TS on the 3 starter
// templates; idempotent on `data-ol-space`.

use once_cell::sync::Lazy;
use regex::Regex;

const SCRIPT_TAG: &str = "<script data-ol-space";
const STYLE_TAG: &str = "<style data-ol-space";

// Tailwind's default spacing scale — (key, value). Mirrors the TS array.
const SCALE: &[(&str, &str)] = &[
    ("0", "0px"),
    ("px", "1px"),
    ("0.5", "0.125rem"),
    ("1", "0.25rem"),
    ("1.5", "0.375rem"),
    ("2", "0.5rem"),
    ("2.5", "0.625rem"),
    ("3", "0.75rem"),
    ("3.5", "0.875rem"),
    ("4", "1rem"),
    ("5", "1.25rem"),
    ("6", "1.5rem"),
    ("7", "1.75rem"),
    ("8", "2rem"),
    ("9", "2.25rem"),
    ("10", "2.5rem"),
    ("11", "2.75rem"),
    ("12", "3rem"),
    ("14", "3.5rem"),
    ("16", "4rem"),
    ("20", "5rem"),
    ("24", "6rem"),
    ("28", "7rem"),
    ("32", "8rem"),
    ("36", "9rem"),
    ("40", "10rem"),
    ("44", "11rem"),
    ("48", "12rem"),
    ("52", "13rem"),
    ("56", "14rem"),
    ("60", "15rem"),
    ("64", "16rem"),
    ("72", "18rem"),
    ("80", "20rem"),
    ("96", "24rem"),
];

fn var_name(key: &str) -> String {
    "--ol-space-".to_string() + &key.replace('.', "_")
}

pub(crate) static CONFIG_SCRIPT: Lazy<String> = Lazy::new(|| {
    let map_entries: Vec<String> = SCALE
        .iter()
        .map(|(k, _)| format!("'{}':'var({})'", k, var_name(k)))
        .collect();
    let map = format!("{{{}}}", map_entries.join(","));

    format!(
        concat!(
            "<script data-ol-space>(function(){{",
            "var w=window;w.tailwind=w.tailwind||{{}};",
            "var c=w.tailwind.config||{{}};var t=c.theme||{{}};var e=t.extend||{{}};",
            "var m={};",
            "e.padding=Object.assign({{}},e.padding,m);",
            "e.margin=Object.assign({{}},e.margin,m);",
            "e.gap=Object.assign({{}},e.gap,m);",
            "w.tailwind.config=Object.assign({{}},c,{{theme:Object.assign({{}},t,",
            "{{extend:Object.assign({{}},e)}})}});",
            "}})();</script>"
        ),
        map
    )
});

static TOKENS_STYLE: Lazy<String> = Lazy::new(|| {
    let tokens_body: String = SCALE
        .iter()
        .map(|(k, v)| format!("{}:calc({}*var(--ol-space-scale));", var_name(k), v))
        .collect();
    format!(
        "<style data-ol-space>:root{{--ol-space-scale:1;{}}}</style>",
        tokens_body
    )
});

static HEAD_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</head>").unwrap());

/// Port of `normalizeSpace` in lib/normalize-space.ts. Idempotencia por
/// PIEZA (script/style separados) — ver el comentario en radius.rs (bug
/// 2026-07-29: el sanitizer mata el script, el style sobrevive, y el chequeo
/// por marcador único nunca re-inyectaba).
pub fn normalize_space(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let has_script = html.contains(SCRIPT_TAG);
    let has_style = html.contains(STYLE_TAG);
    if has_script && has_style {
        return html.to_string();
    }
    let mut injection = String::new();
    if !has_script {
        injection.push_str(&CONFIG_SCRIPT);
    }
    if !has_style {
        injection.push_str(&TOKENS_STYLE);
    }
    match HEAD_CLOSE_RE.find(html) {
        Some(m) => {
            let mut out = String::with_capacity(html.len() + injection.len());
            out.push_str(&html[..m.start()]);
            out.push_str(&injection);
            out.push_str(&html[m.start()..]);
            out
        }
        None => {
            let mut out = String::with_capacity(html.len() + injection.len());
            out.push_str(html);
            out.push_str(&injection);
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "<html><head><script src=\"https://cdn.tailwindcss.com\"></script></head><body><div class=\"p-4 gap-2\"></div></body></html>";

    fn strip_tag(html: &str, open: &str) -> String {
        let start = html.find(open).expect("open tag");
        let end = html[start..].find("</script>").expect("close tag") + start + "</script>".len();
        format!("{}{}", &html[..start], &html[end..])
    }

    #[test]
    fn reinjects_script_when_only_style_survives() {
        let once = normalize_space(DOC);
        let stripped = strip_tag(&once, "<script data-ol-space>");
        assert!(!stripped.contains("<script data-ol-space"));
        let healed = normalize_space(&stripped);
        assert!(healed.contains("<script data-ol-space>"));
        assert_eq!(healed.matches("<style data-ol-space").count(), 1);
        assert_eq!(strip_tag(&healed, "<script data-ol-space>"), stripped);
    }

    #[test]
    fn repair_is_idempotent() {
        let once = normalize_space(DOC);
        let stripped = strip_tag(&once, "<script data-ol-space>");
        let healed = normalize_space(&stripped);
        assert_eq!(normalize_space(&healed), healed);
        assert_eq!(healed.matches("<script data-ol-space").count(), 1);
    }
}
