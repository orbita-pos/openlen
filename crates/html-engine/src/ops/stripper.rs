use once_cell::sync::Lazy;
use regex::Regex;

/// Matches `data-op-id="<base36>"` together with the whitespace that precedes
/// it inside an open tag, so stripping leaves the tag spacing tidy. Mirrors
/// the JS regex `/\s*data-op-id="[a-z0-9]+"/gi` exactly.
static OP_ID_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)\s*data-op-id="[a-z0-9]+""#).expect("op-id strip regex compiles")
});

/// Cheap regex strip — avoids a parse+serialize round trip on a document that
/// may already be ~60KB. The attribute value alphabet is `[a-z0-9]` so the
/// regex is bounded and safe. Always called before persisting / publishing.
pub fn strip_op_ids(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    OP_ID_RE.replace_all(html, "").into_owned()
}
