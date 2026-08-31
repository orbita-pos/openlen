// sanitize_for_publish — the single Rust gate that consolidates six TS-side
// `data-slot-path=` checks (publish, from-html, from-template, html PATCH,
// ai-design, admin/templates) plus the hand-rolled XSS sanitizer from
// lib/style-match/autofill/sanitize.ts.
//
// Contract:
//   - Clean input → byte-equal output, errors empty.
//   - Idempotent: `sanitize(sanitize(x)).html == sanitize(x).html`.
//   - `data-slot-path=` detected in ANY position (attribute, text, comment,
//     CDATA, entity-encoded, mixed-case, whitespace-around-equals) → hard
//     reject: `html = None`, `errors` carries a position-tagged reason.
//   - XSS-shaped content (inline scripts, on*-handlers, javascript:/vbscript:
//     URLs, embed elements, meta http-equiv refresh/set-cookie) → silently
//     stripped, counted in `removed`, no error.
//
// Order of operations: slot_path gate first (fail-fast), then the four
// silent-strip passes in this order:
//   1. scripts        (removes <script>, leaves whitelisted Tailwind CDN)
//   2. elements       (removes iframe/object/embed/applet/portal + meta refresh)
//   3. handlers       (removes on*= attributes)
//   4. urls           (drops dangerous-scheme href/src/action/...)
// Each pass is a self-contained lol-html rewrite; on clean inputs each pass
// is byte-equal, so the chain is byte-equal too. The handful of extra
// rewrite passes is well under the chat-turn budget (~3 ms total on a 60KB
// starter template; cf. session 2 normalize chain at ~3.4 ms for 7 passes).

pub mod elements;
pub mod handlers;
pub mod scripts;
pub mod slot_path;
pub mod url;
pub mod urls;

pub use slot_path::{detect_slot_path, SlotPathDetection, SlotPathPosition};

/// Per-pass counters surfaced via the napi result for telemetry. Telemetry
/// matters for incident response — "the AI is suddenly emitting 100x more
/// dangerous URLs" is the kind of signal we want to plot before it becomes
/// a user-facing problem. Mirrors the shape of SanitizeResult.removed in
/// the TS reference.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RemovedCounts {
    pub scripts: u32,
    pub event_handlers: u32,
    pub dangerous_urls: u32,
    pub iframes: u32,
    pub meta_refresh: u32,
}

#[derive(Debug, Clone)]
pub struct SanitizeResult {
    /// Sanitized HTML if the slot-path gate passed; None on a slot-path
    /// detection (caller must NOT publish in that case).
    pub html: Option<String>,
    /// One-line, position-tagged reasons for each blocking failure. Empty on
    /// success. Today only the slot-path gate produces errors; future
    /// blocking checks (e.g. size limits) would push into the same list.
    pub errors: Vec<String>,
    /// Counts of silently-removed XSS-shaped content. Populated even on
    /// success; zero when the input was clean.
    pub removed: RemovedCounts,
}

/// Entry point. See module-level docs for the contract.
pub fn sanitize_for_publish(html: &str) -> SanitizeResult {
    if let Some(hit) = detect_slot_path(html) {
        return SanitizeResult {
            html: None,
            errors: vec![format!(
                "data-slot-path detected ({}, at byte offset {})",
                hit.position, hit.offset
            )],
            removed: RemovedCounts::default(),
        };
    }

    let mut removed = RemovedCounts::default();
    let s1 = match scripts::strip_scripts(html, &mut removed) {
        Ok(s) => s,
        Err(e) => {
            return SanitizeResult {
                html: None,
                errors: vec![format!("sanitize/scripts pass failed: {}", e)],
                removed,
            };
        }
    };
    let s2 = match elements::strip_dangerous_elements(&s1, &mut removed) {
        Ok(s) => s,
        Err(e) => {
            return SanitizeResult {
                html: None,
                errors: vec![format!("sanitize/elements pass failed: {}", e)],
                removed,
            };
        }
    };
    let s3 = match handlers::strip_event_handlers(&s2, &mut removed) {
        Ok(s) => s,
        Err(e) => {
            return SanitizeResult {
                html: None,
                errors: vec![format!("sanitize/handlers pass failed: {}", e)],
                removed,
            };
        }
    };
    let s4 = match urls::strip_dangerous_urls(&s3, &mut removed) {
        Ok(s) => s,
        Err(e) => {
            return SanitizeResult {
                html: None,
                errors: vec![format!("sanitize/urls pass failed: {}", e)],
                removed,
            };
        }
    };

    SanitizeResult {
        html: Some(s4),
        errors: vec![],
        removed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_input_byte_equal() {
        let html = "<div class=\"foo\"><p>hello</p></div>";
        let r = sanitize_for_publish(html);
        assert_eq!(r.html.as_deref(), Some(html));
        assert!(r.errors.is_empty());
        assert_eq!(r.removed, RemovedCounts::default());
    }

    #[test]
    fn slot_path_blocks_other_passes() {
        // Input has both data-slot-path AND a <script> — slot-path bails the
        // entire pipeline before the script can be counted-and-stripped.
        let html = "<div data-slot-path=\"x\"></div><script>bad()</script>";
        let r = sanitize_for_publish(html);
        assert!(r.html.is_none());
        assert_eq!(r.errors.len(), 1);
        assert!(r.errors[0].contains("data-slot-path"));
        // No work was done after the gate fired.
        assert_eq!(r.removed, RemovedCounts::default());
    }

    #[test]
    fn all_strippers_compose() {
        let html = r#"<div onclick="x()"><iframe></iframe><script>y()</script><a href="javascript:z()">q</a></div>"#;
        let r = sanitize_for_publish(html);
        assert!(r.errors.is_empty());
        let out = r.html.unwrap();
        assert!(!out.contains("onclick"));
        assert!(!out.contains("<iframe"));
        assert!(!out.contains("<script"));
        assert!(!out.contains("javascript:"));
        assert_eq!(r.removed.scripts, 1);
        assert_eq!(r.removed.iframes, 1);
        assert_eq!(r.removed.event_handlers, 1);
        assert_eq!(r.removed.dangerous_urls, 1);
    }

    #[test]
    fn idempotent_on_dirty_input() {
        let html = r#"<div onclick="x()"><iframe></iframe><script>y()</script></div>"#;
        let r1 = sanitize_for_publish(html).html.unwrap();
        let r2 = sanitize_for_publish(&r1).html.unwrap();
        assert_eq!(r1, r2);
    }

    #[test]
    fn idempotent_on_clean_input() {
        let html = "<section class=\"hero\"><h1>Title</h1></section>";
        let r1 = sanitize_for_publish(html).html.unwrap();
        let r2 = sanitize_for_publish(&r1).html.unwrap();
        assert_eq!(r1, r2);
        assert_eq!(r1, html);
    }

    #[test]
    fn empty_input_passes() {
        let r = sanitize_for_publish("");
        assert_eq!(r.html.as_deref(), Some(""));
        assert!(r.errors.is_empty());
    }

    #[test]
    fn slot_path_in_comment_blocks() {
        let r = sanitize_for_publish("<!-- data-slot-path=foo --><div>x</div>");
        assert!(r.html.is_none());
        assert!(r.errors[0].contains("data-slot-path"));
    }

    #[test]
    fn slot_path_entity_encoded_blocks() {
        let r = sanitize_for_publish("<div &#100;ata-slot-path=\"x\">");
        assert!(r.html.is_none());
        assert!(r.errors[0].contains("entity-encoded"));
    }

    #[test]
    fn slot_path_mixed_case_blocks() {
        let r = sanitize_for_publish("<div Data-Slot-Path=\"x\">");
        assert!(r.html.is_none());
        assert!(r.errors[0].contains("mixed-case"));
    }
}
