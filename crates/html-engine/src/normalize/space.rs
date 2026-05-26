// Born-canonical spacing (density) normalization — port of
// lib/normalize-space.ts. Pure injection (no CSS rewrite): marker check,
// then INJECTION before </head>. Byte-equal to TS on the 3 starter
// templates; idempotent on `data-ol-space`.

use once_cell::sync::Lazy;
use regex::Regex;

const SPACE_MARKER: &str = "data-ol-space";

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

static INJECTION: Lazy<String> = Lazy::new(|| {
    let map_entries: Vec<String> = SCALE
        .iter()
        .map(|(k, _)| format!("'{}':'var({})'", k, var_name(k)))
        .collect();
    let map = format!("{{{}}}", map_entries.join(","));

    let config_script = format!(
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
    );

    let tokens_body: String = SCALE
        .iter()
        .map(|(k, v)| format!("{}:calc({}*var(--ol-space-scale));", var_name(k), v))
        .collect();
    let tokens_style = format!(
        "<style data-ol-space>:root{{--ol-space-scale:1;{}}}</style>",
        tokens_body
    );

    config_script + &tokens_style
});

static HEAD_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</head>").unwrap());

/// Port of `normalizeSpace` in lib/normalize-space.ts.
pub fn normalize_space(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    if html.contains(SPACE_MARKER) {
        return html.to_string();
    }
    let injection: &str = &INJECTION;
    match HEAD_CLOSE_RE.find(html) {
        Some(m) => {
            let mut out = String::with_capacity(html.len() + injection.len());
            out.push_str(&html[..m.start()]);
            out.push_str(injection);
            out.push_str(&html[m.start()..]);
            out
        }
        None => {
            let mut out = String::with_capacity(html.len() + injection.len());
            out.push_str(html);
            out.push_str(injection);
            out
        }
    }
}
