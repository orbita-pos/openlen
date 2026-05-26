// optimize_for_publish — publish-time HTML minifier.
//
// Contract:
//   - Idempotent: `optimize(optimize(x)).html == optimize(x).html`.
//   - Bytes-out ≤ bytes-in. Target ≥20% reduction on the starter pack.
//   - Output is HTML5-valid and renders identically to input. minify-html's
//     default Cfg is the conservative one we want: comments stripped,
//     whitespace collapsed in normal flow, optional-closing tags omitted
//     (per HTML5 spec — browsers handle this fine), but attribute quotes
//     preserved and all noncompliant shortcuts off.
//   - Errors are returned in `errors`, not panics. Today the only error
//     path is "input contained data-slot-path=" — minify itself doesn't
//     fail-fast on malformed HTML (minify-html parses leniently).
//
// What this module does NOT do this session (Sem 8, Option C — see the
// session-4 handoff for the full reasoning):
//
//   - Tailwind CDN script strip + bake. The TS reference
//     (`lib/publish/optimize-html.ts`) wires PostCSS + tailwindcss to
//     generate a content-aware CSS bundle, then swaps the `<script
//     src="cdn.tailwindcss.com">` for a `<style>` containing only the
//     utilities used. Replicating that without invoking Node-side
//     Tailwind requires either (a) a comprehensive lookup table — which
//     can't cover arbitrary-value syntax `bg-[#hex]`, `max-w-[1240px]`,
//     `text-[color:var(...)]` that the starters use heavily — or (b)
//     a full Tailwind matcher port. Both are big enough to deserve
//     their own session. For now optimize_for_publish leaves the CDN
//     `<script>` intact, so production pages still get Tailwind via
//     the runtime; the win we ship here is HTML + inline-CSS minify
//     on top.
//
//   - Standalone CSS minify entry point. minify-html v0.16 has
//     `Cfg.minify_css = true`, which routes inline `<style>` blocks and
//     `style="..."` attribute values through lightningcss internally.
//     A separate `css.rs` exposing the same crate is redundant; we'll
//     add it the day we need to minify raw CSS strings outside the
//     HTML context (e.g. for the future Tailwind bake).

pub mod html;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OptimizeStats {
    pub bytes_in: u32,
    pub bytes_out: u32,
    /// True when the Tailwind CDN script was successfully swapped for
    /// inline `<style>`. Always false in Sem 8 (the bake is deferred —
    /// see module-level docs); reserved for the future session that
    /// ships the CDN handling.
    pub css_inlined: bool,
    /// Count of Tailwind utility classes kept in the inlined CSS.
    /// Always 0 in Sem 8; reserved for the future session.
    pub tailwind_classes_kept: u32,
}

#[derive(Debug, Clone)]
pub struct OptimizeResult {
    /// Optimized HTML when the gate passes; None when the input
    /// carries the editor-mode marker `data-slot-path=` (publish-block
    /// — defense-in-depth with sanitize_for_publish).
    pub html: Option<String>,
    /// Position-tagged blocking reasons. Empty on success.
    pub errors: Vec<String>,
    pub stats: OptimizeStats,
}

/// Entry point. Idempotent; safe to call on already-optimized HTML.
pub fn optimize_for_publish(html: &str) -> OptimizeResult {
    // Defense in depth — sanitize_for_publish runs the same gate
    // earlier, but publish-time optimize is the last gate before disk.
    // If a slot-path marker survives every other check, fail here.
    if let Some(hit) = crate::sanitize::detect_slot_path(html) {
        return OptimizeResult {
            html: None,
            errors: vec![format!(
                "data-slot-path detected ({}, at byte offset {})",
                hit.position, hit.offset
            )],
            stats: OptimizeStats {
                bytes_in: html.len() as u32,
                bytes_out: 0,
                css_inlined: false,
                tailwind_classes_kept: 0,
            },
        };
    }

    let bytes_in = html.len() as u32;
    let minified = match html::minify_html_for_publish(html) {
        Ok(s) => s,
        Err(e) => {
            return OptimizeResult {
                html: None,
                errors: vec![format!("minify/html pass failed: {}", e)],
                stats: OptimizeStats {
                    bytes_in,
                    bytes_out: 0,
                    css_inlined: false,
                    tailwind_classes_kept: 0,
                },
            };
        }
    };
    let bytes_out = minified.len() as u32;

    OptimizeResult {
        html: Some(minified),
        errors: vec![],
        stats: OptimizeStats {
            bytes_in,
            bytes_out,
            css_inlined: false,
            tailwind_classes_kept: 0,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_passes() {
        let r = optimize_for_publish("");
        assert_eq!(r.html.as_deref(), Some(""));
        assert!(r.errors.is_empty());
        assert_eq!(r.stats.bytes_in, 0);
        assert_eq!(r.stats.bytes_out, 0);
    }

    #[test]
    fn slot_path_blocks_optimize() {
        // Defense in depth: even if sanitize was somehow bypassed, the
        // publish-time optimize gate still rejects.
        let html = "<div data-slot-path=\"foo\"><p>hi</p></div>";
        let r = optimize_for_publish(html);
        assert!(r.html.is_none());
        assert_eq!(r.errors.len(), 1);
        assert!(r.errors[0].contains("data-slot-path"));
        // bytes_in should still be reported so callers can log it.
        assert_eq!(r.stats.bytes_in as usize, html.len());
        assert_eq!(r.stats.bytes_out, 0);
    }

    #[test]
    fn idempotent_on_simple_input() {
        let html =
            "<!doctype html><html><head><title>x</title></head><body><p>hi</p></body></html>";
        let r1 = optimize_for_publish(html).html.unwrap();
        let r2 = optimize_for_publish(&r1).html.unwrap();
        assert_eq!(r1, r2);
    }

    #[test]
    fn reduces_simple_whitespace() {
        let html = "<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body>\n    <p>hi</p>\n  </body>\n</html>\n";
        let r = optimize_for_publish(html);
        assert!(r.errors.is_empty());
        let out = r.html.unwrap();
        assert!(
            out.len() < html.len(),
            "expected reduction, got {} -> {}",
            html.len(),
            out.len()
        );
        assert_eq!(r.stats.bytes_in as usize, html.len());
        assert_eq!(r.stats.bytes_out as usize, out.len());
    }

    #[test]
    fn stats_default_for_deferred_cdn_handling() {
        // Sem 8 Option C: CDN strip is deferred, so even when the CDN
        // script is present, css_inlined stays false and
        // tailwind_classes_kept stays 0. Documents the contract for the
        // future session that ships the bake.
        let html = r#"<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-red-500">x</body></html>"#;
        let r = optimize_for_publish(html);
        assert!(r.errors.is_empty());
        assert!(!r.stats.css_inlined);
        assert_eq!(r.stats.tailwind_classes_kept, 0);
        // CDN script still in output — bake is deferred.
        assert!(r.html.unwrap().contains("cdn.tailwindcss.com"));
    }
}
