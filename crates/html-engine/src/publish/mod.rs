// Publish-time DOM mutations migrated from cheerio in F1.5.
//
// Each module here is one of the four non-Motor-HTML consumers F1 S9 left
// behind on cheerio. They run during the publish pipeline (lib/publish/
// filesystem.ts) and operate on the final HTML right before it lands on
// disk. All implementations are kuchikiki-backed — next-sibling checks,
// rel-token tokenisation, and conditional child appends don't fit
// lol-html's single-pass streaming model the way the sanitize / normalize
// passes do.

pub mod logo;

pub use logo::{extract_logo, inject_logo, ExtractedLogo};

use kuchikiki::traits::TendrilSink;
use kuchikiki::NodeRef;

/// Parse an HTML fragment and return its top-level nodes, detached from any
/// parent so they can be moved into a destination tree.
///
/// html5ever's full-document parser auto-wraps the fragment in
/// `<html><head>…<body>…`; we drain BOTH the synthesized head and body so
/// fragments like `<link>` (head-bound) and `<input>` (body-bound) both
/// work without the caller having to know which one html5ever picked.
pub(crate) fn parse_fragment_children(html: &str) -> Vec<NodeRef> {
    let doc = kuchikiki::parse_html().one(html);
    let mut out: Vec<NodeRef> = Vec::new();
    if let Ok(head) = doc.select_first("head") {
        out.extend(head.as_node().children());
    }
    if let Ok(body) = doc.select_first("body") {
        out.extend(body.as_node().children());
    }
    for n in &out {
        n.detach();
    }
    out
}

/// Escape `&` and `"` for safe interpolation into a double-quoted HTML
/// attribute value. Mirror of `escapeAttr` in lib/branding/inject-logo.ts.
pub(crate) fn escape_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

/// Serialize a kuchikiki document (or subtree) back to a UTF-8 HTML string.
/// Returns an empty string on serialization error — kuchikiki only fails here
/// on IO, which can't happen with an in-memory Vec, but we don't unwrap on
/// principle.
pub(crate) fn serialize_doc(root: &NodeRef) -> String {
    let mut out: Vec<u8> = Vec::new();
    if root.serialize(&mut out).is_err() {
        return String::new();
    }
    String::from_utf8(out).unwrap_or_default()
}
