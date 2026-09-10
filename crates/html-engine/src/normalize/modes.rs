// Born-canonical light/dark mode normalization.
// ⚰️ Decía «port of lib/normalize-modes.ts» y ese fichero YA NO EXISTE: el
// gemelo de TypeScript se retiró y Rust es la única implementación.
// Lifts the page's `:root.dark { … }` palette onto the canonical
// :root[data-ol-mode="dark"] tokens over --ol-* and removes the model's
// own block. No-op when no `:root.dark` palette ships. Byte-equal vs TS
// on 3 starter templates; idempotent on data-ol-modes.

use once_cell::sync::Lazy;
use regex::Regex;

const MODES_MARKER: &str = "data-ol-modes";

struct RoleToken {
    src: &'static str,
    ol: &'static str,
}

const ROLE_TOKENS: &[RoleToken] = &[
    RoleToken {
        src: "bg",
        ol: "--ol-bg",
    },
    RoleToken {
        src: "surface",
        ol: "--ol-surface",
    },
    RoleToken {
        src: "fg",
        ol: "--ol-fg",
    },
    RoleToken {
        src: "border",
        ol: "--ol-border",
    },
    RoleToken {
        src: "accent",
        ol: "--ol-accent",
    },
];

static DARK_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i):root\.dark\s*\{([^}]*)\}").unwrap());
/// Cualquier custom property del bloque oscuro. Sirve para llevarse las que
/// NO son uno de los cinco roles — que son la mayoría de la paleta.
static DARK_DECL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)--([a-z0-9-]+)\s*:\s*([^;}]+)").unwrap());
static HEX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^#([0-9a-f]{3}|[0-9a-f]{6})$").unwrap());
static HEAD_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</head>").unwrap());

fn hex_triplet(value: &str) -> Option<String> {
    let v = value.trim();
    let caps = HEX_RE.captures(v)?;
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
    let r = u8::from_str_radix(&expanded[0..2], 16).ok()?;
    let g = u8::from_str_radix(&expanded[2..4], 16).ok()?;
    let b = u8::from_str_radix(&expanded[4..6], 16).ok()?;
    Some(format!("{},{},{}", r, g, b))
}

/// Levanta la paleta oscura del modelo al bloque canónico.
pub fn normalize_color_modes(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    if html.contains(MODES_MARKER) {
        return html.to_string();
    }
    let Some(dark) = DARK_BLOCK_RE.captures(html) else {
        return html.to_string();
    };
    let body = dark.get(1).unwrap().as_str();

    let mut decls = String::new();
    for role in ROLE_TOKENS {
        let pat = format!(r"(?i)--{}\s*:\s*([^;}}]+)", role.src);
        let re = Regex::new(&pat).unwrap();
        let Some(m) = re.captures(body) else {
            continue;
        };
        let val = m.get(1).unwrap().as_str().trim();
        decls.push_str(role.ol);
        decls.push(':');
        decls.push_str(val);
        decls.push(';');
        if role.src == "accent" {
            if let Some(trip) = hex_triplet(val) {
                decls.push_str("--ol-accent-r:");
                decls.push_str(&trip);
                decls.push(';');
            }
        }
    }
    // 🔴 Y TODO LO DEMÁS que el modelo escribió en su :root.dark, TAL CUAL.
    //
    // Hasta el 2026-09-09 sólo salían los cinco roles de arriba y el resto se
    // tiraba. Medido en las plantillas que traen paleta oscura: el modelo
    // escribe SIEMPRE 11 tokens o más —surface-2, fg-muted, fg-faint,
    // border-strong, accent-r, accent-ink, y los suyos propios (warn, danger,
    // gold-soft…)—, así que se perdía más de la mitad. Los tokens perdidos se
    // quedaban con su valor del modo CLARO, y como el fondo sí volteaba, el
    // texto secundario acababa oscuro sobre oscuro: medido en una página real,
    // 66 de 102 textos por debajo de AA, y las iniciales de un avatar a 1:1.
    //
    // Los cinco roles se saltan a propósito: ya salieron arriba como --ol-*, y
    // repetirlos aquí en su forma cruda pisaría lo que ponga una temática (que
    // escribe --ol-* en la raíz, ver lib/tematicas/apply-server.ts).
    for cap in DARK_DECL_RE.captures_iter(body) {
        // El nombre se compara en minúsculas, pero se EMITE tal cual: las
        // custom properties de CSS distinguen mayúsculas.
        let name = cap.get(1).unwrap().as_str();
        if ROLE_TOKENS
            .iter()
            .any(|r| r.src.eq_ignore_ascii_case(name))
        {
            continue;
        }
        decls.push_str("--");
        decls.push_str(name);
        decls.push(':');
        decls.push_str(cap.get(2).unwrap().as_str().trim());
        decls.push(';');
    }

    if decls.is_empty() {
        return html.to_string();
    }

    let dark_full = dark.get(0).unwrap().as_str().to_string();
    let out = html.replacen(&dark_full, "", 1);
    let style = format!(
        r#"<style data-ol-modes>:root[data-ol-mode="dark"]{{{}}}</style>"#,
        decls
    );
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
