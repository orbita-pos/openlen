// Publish-time DOM mutations consolidated in F1.5 — see
// docs/rust-f1-5-handoff.md for the migration history. Each module here
// is one of the four non-Motor-HTML consumers F1 S9 left on the legacy TS
// parser. They run during the publish pipeline (lib/publish/filesystem.ts)
// and operate on the final HTML right before it lands on disk. All
// implementations are kuchikiki-backed — next-sibling checks, rel-token
// tokenisation, and conditional child appends don't fit lol-html's
// single-pass streaming model the way the sanitize / normalize passes do.

pub mod credits;
pub mod forms;
pub mod harden;
pub mod images;
pub mod logo;
pub mod photos;
pub mod seal;
pub mod translate;

pub use credits::{consolidate_unsplash_credits, ConsolidationResult, UnsplashCredit};
pub use forms::{wire_published_forms, FormConfig};
pub use harden::{harden_visual_quality, HardenCounts, HardenResult, HardenWarning, WarningKind};
pub use images::{rewrite_responsive_images, ResponsiveImage, RewriteImagesResult};
pub use logo::{extract_logo, inject_logo, ExtractedLogo};
pub use photos::{
    apply_photo_slots, extract_photo_slots, ApplyResult as PhotoApplyResult, PhotoAssignment,
    PhotoSlot,
};
pub use seal::{seal_release, SealResult};
pub use translate::{extract_translatables, reinject_translatables};

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

/// Stricter attribute escape — also encodes `<` and `>`. Mirror of the inline
/// `escapeAttr` in lib/publish/credits.ts where values are user-controlled
/// photographer names / URLs that could contain HTML-meaningful characters.
pub(crate) fn escape_attr_strict(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(c),
        }
    }
    out
}

/// Escape `&`, `<`, `>` for safe interpolation into HTML element text.
/// Mirror of `escapeHtml` in lib/publish/credits.ts.
pub(crate) fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
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
