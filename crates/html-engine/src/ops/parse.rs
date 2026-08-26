use once_cell::sync::Lazy;
use regex::Regex;

use super::apply::{Op, OpType};

#[derive(Debug, Clone)]
pub struct ParseResult {
    pub ops: Vec<Op>,
    pub errors: Vec<String>,
}

static OPS_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<edits[^>]*>(.*?)</edits>").expect("ops block regex compiles"));
/// UNA sola expresión para las DOS formas, y por eso una sola pasada.
///
/// Antes eran dos, y se SOLAPABAN: la de la forma abierta era
/// `<edit\b([^>]*)>(.*?)</edit>`, y `[^>]*` casa también la `/` de una etiqueta
/// auto-cerrada porque `/` no es `>`. Con esta entrada:
///
///     <edit op="delete" target="a"/><edit op="replace" target="b"><new>x</new></edit>
///
/// la primera pasada emitía `delete:a`, y la segunda volvía a casar desde el
/// mismo `<edit`, se tragaba el segundo edit entero como si fuera su contenido y
/// emitía OTRO `delete:a`. Resultado: la op duplicada, la siguiente DESAPARECIDA
/// y `errors` VACÍO — «quítame el carrito y pon el título en rojo» borraba el
/// carrito dos veces y dejaba el título igual, sin un solo aviso.
///
/// La alternancia lleva la forma auto-cerrada DELANTE a propósito: el crate
/// `regex` resuelve alternancias leftmost-FIRST, así que en la misma posición
/// gana la primera rama, que es la específica. Al revés, `<edit a/>` volvería a
/// caer en la rama abierta.
///
/// Y de paso arregla el ORDEN. Con dos pasadas, TODAS las auto-cerradas salían
/// antes que cualquier abierta, mientras el prompt promete «applied in emission
/// order». Con una sola pasada salen como el modelo las escribió.
static EDIT_ANY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)<edit\b([^>]*?)\s*/>|<edit\b([^>]*)>(.*?)</edit>")
        .expect("edit regex compiles")
});
static ATTR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(\w[\w-]*)\s*=\s*"([^"]*)""#).expect("attr regex compiles"));
static NEW_INNER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<new[^>]*>(.*?)</new>").expect("new inner regex compiles"));

/// Parse the `<edits>...</edits>` envelope Kimi emits in ops mode. Tolerant
/// to surrounding whitespace + markdown fences (already stripped by caller).
/// Returns ops in emission order — de verdad desde el 2026-08-25: antes las
/// auto-cerradas salían TODAS primero (dos pasadas), contra lo que el prompt
/// promete. Ver `EDIT_ANY_RE` para el defecto que eso escondía.
pub fn parse_ops(raw_html: &str) -> ParseResult {
    let mut errors: Vec<String> = Vec::new();
    if raw_html.trim().is_empty() {
        errors.push("Empty ops body".to_string());
        return ParseResult {
            ops: vec![],
            errors,
        };
    }

    let block = match OPS_BLOCK_RE.captures(raw_html) {
        Some(c) => c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
        None => {
            errors.push(
                "No <edits>…</edits> block found in the response. The model may have emitted a full document instead — caller should fall back to rewrite mode.".to_string()
            );
            return ParseResult {
                ops: vec![],
                errors,
            };
        }
    };

    let mut ops: Vec<Op> = Vec::new();

    // UNA pasada, en el orden en que el modelo las escribió.
    for cap in EDIT_ANY_RE.captures_iter(&block) {
        // Rama 1 = auto-cerrada (sólo atributos). Rama 2 = abierta (atributos +
        // contenido). Exactamente una de las dos casa.
        let auto_cerrada = cap.get(1).is_some();
        let attrs_raw = cap
            .get(1)
            .or_else(|| cap.get(2))
            .map(|m| m.as_str())
            .unwrap_or("");
        let inner = cap.get(3).map(|m| m.as_str()).unwrap_or("");
        let attrs = parse_attrs(attrs_raw);
        let op_str = attrs.get("op").cloned();
        let target = attrs.get("target").cloned();
        let (op_str, target) = match (op_str, target) {
            (Some(o), Some(t)) => (o, t),
            _ => {
                errors.push(if auto_cerrada {
                    "<edit/> missing op or target attribute".to_string()
                } else {
                    "<edit> missing op or target attribute".to_string()
                });
                continue;
            }
        };
        let op_type = match OpType::parse(&op_str) {
            Some(o) => o,
            None => {
                errors.push(format!("Unknown op type \"{}\"", op_str));
                continue;
            }
        };
        if auto_cerrada {
            if op_type != OpType::Delete {
                errors.push(format!(
                    "Op \"{}\" requires <new>...</new> content; can't be self-closing.",
                    op_str
                ));
                continue;
            }
            ops.push(Op {
                op_type,
                target,
                new_html: None,
            });
            continue;
        }
        // Forma abierta.
        if op_type == OpType::Delete {
            ops.push(Op {
                op_type,
                target,
                new_html: None,
            });
            continue;
        }
        // Accept either <new>..</new> wrapped or raw inner content (Kimi
        // prefers raw). When a <new> wrapper exists, use its inner content.
        let raw_new = match NEW_INNER_RE.captures(inner) {
            Some(c) => c.get(1).map(|m| m.as_str()).unwrap_or("").to_string(),
            None => inner.to_string(),
        };
        let raw_new = raw_new.trim().to_string();
        if raw_new.is_empty() {
            errors.push(format!(
                "Op \"{}\" target=\"{}\" has empty content between <edit>...</edit>",
                op_str, target
            ));
            continue;
        }
        ops.push(Op {
            op_type,
            target,
            new_html: Some(raw_new),
        });
    }

    ParseResult { ops, errors }
}

fn parse_attrs(raw: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for cap in ATTR_RE.captures_iter(raw) {
        let k = cap.get(1).unwrap().as_str().to_ascii_lowercase();
        let v = cap.get(2).unwrap().as_str().to_string();
        out.insert(k, v);
    }
    out
}
