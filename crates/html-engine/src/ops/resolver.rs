use kuchikiki::traits::TendrilSink;

use super::OP_ID_ATTR;

/// Resolve a CSS-selector breadcrumb (from the iframe's section-select
/// script) against an already-tagged document, returning the matched
/// element's `data-op-id`. Used by the Chat AI route to turn a click
/// gesture into a hard pin for Kimi.
///
/// Returns `None` when the path is empty, the document doesn't parse, the
/// selector itself is invalid, or it doesn't match anything. The caller
/// falls back to the textual hint in that case — so a miss never breaks
/// the request.
pub fn resolve_op_id_by_path(tagged_html: &str, path: &str) -> Option<String> {
    if path.trim().is_empty() {
        return None;
    }
    if tagged_html.trim().is_empty() {
        return None;
    }
    let doc = kuchikiki::parse_html().one(tagged_html);
    // The client builds paths starting at the first descendant of <body>;
    // anchoring here makes the selector unambiguous in docs that repeat
    // structures (e.g. <main><section>… inside <body><main>).
    let full = if path.starts_with("body") {
        path.to_string()
    } else {
        format!("body > {}", path)
    };
    let mut matched = match doc.select(&full) {
        Ok(it) => it,
        Err(_) => return None,
    };
    let first = matched.next()?;
    let attrs = first.attributes.borrow();
    let id = attrs.get(OP_ID_ATTR)?;
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}
