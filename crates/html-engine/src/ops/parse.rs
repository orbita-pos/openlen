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
static EDIT_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<edit\b([^>]*)>(.*?)</edit>").expect("edit regex compiles"));
static SELF_CLOSING_EDIT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<edit\b([^>]*)/>").expect("self-closing edit regex compiles"));
static ATTR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(\w[\w-]*)\s*=\s*"([^"]*)""#).expect("attr regex compiles"));
static NEW_INNER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<new[^>]*>(.*?)</new>").expect("new inner regex compiles"));

/// Parse the `<edits>...</edits>` envelope Kimi emits in ops mode. Tolerant
/// to surrounding whitespace + markdown fences (already stripped by caller).
/// Returns ops in emission order. Self-closing `<edit/>` forms collected
/// before open-close `<edit>...</edit>` ones — matches the TS pass order so
/// the shadow soak diff stays clean.
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

    // Self-closing first.
    for cap in SELF_CLOSING_EDIT_RE.captures_iter(&block) {
        let attrs_raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let attrs = parse_attrs(attrs_raw);
        let op_str = attrs.get("op").cloned();
        let target = attrs.get("target").cloned();
        let (op_str, target) = match (op_str, target) {
            (Some(o), Some(t)) => (o, t),
            _ => {
                errors.push("<edit/> missing op or target attribute".to_string());
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
    }

    // Open-close form.
    for cap in EDIT_BLOCK_RE.captures_iter(&block) {
        let attrs_raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let inner = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let attrs = parse_attrs(attrs_raw);
        let op_str = attrs.get("op").cloned();
        let target = attrs.get("target").cloned();
        let (op_str, target) = match (op_str, target) {
            (Some(o), Some(t)) => (o, t),
            _ => {
                errors.push("<edit> missing op or target attribute".to_string());
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
