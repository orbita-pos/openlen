// minify-html wrapper. Configured for publish-time output that:
//   - removes whitespace + comments
//   - minifies inline CSS via lightningcss (minify-html v0.16 routes
//     `<style>` blocks + `style="..."` attrs through lightningcss
//     internally when `minify_css = true`)
//   - keeps the document parseable by both Tailwind's runtime (it walks
//     the DOM for classes) and the future Sem-N CSS bake step
//
// We deliberately keep the minify on the "spec-compliant only" side:
//   - allow_noncompliant_unquoted_attribute_values OFF
//     (the runtime CSS-in-JS we emit relies on quoted attrs like
//      `class="bg-[rgba(15,15,15,0.72)]"` — unquoted variants would
//      need re-escaping of `(`, `[`, etc.)
//   - allow_removing_spaces_between_attributes OFF
//     (cheap insurance against any downstream parser that still wants
//      whitespace between adjacent attribute tokens)
//   - keep_input_type_text_attr OFF — default behavior strips the
//     redundant attribute, which is HTML5-compliant and a real byte win
//
// JS minification: OFF this session. mirror.html ships an inline
// `<script>` block of procedural sparklines that's small (<2KB) and
// already author-minified by us. Turning on `minify_js = true` would
// route it through minify-js, which costs ~5MB on the dependency tree
// and historically has produced regressions on edge-case JS. Defer
// until we have a concrete reduction win measured against the cost.

use minify_html::{minify, Cfg};

#[derive(Debug, thiserror::Error)]
pub enum MinifyHtmlError {
    #[error("output was not valid UTF-8 ({0})")]
    InvalidUtf8(std::string::FromUtf8Error),
}

/// Conservative publish-time minify. Idempotent on its own output.
pub fn minify_html_for_publish(html: &str) -> Result<String, MinifyHtmlError> {
    let cfg = publish_cfg();
    let out_bytes = minify(html.as_bytes(), &cfg);
    String::from_utf8(out_bytes).map_err(MinifyHtmlError::InvalidUtf8)
}

fn publish_cfg() -> Cfg {
    let mut cfg = Cfg::new();
    // Inline CSS minification — runs lightningcss on every `<style>`
    // block and every `style="..."` attribute. The lightningcss output
    // is itself idempotent, so re-running optimize is a no-op.
    cfg.minify_css = true;
    // JS minify intentionally off (see file-level note).
    cfg.minify_js = false;
    // KEEP closing tags. minify-html v0.16's optional-closing-tag
    // omission is NOT idempotent on real-world HTML: in mirror.html a
    // `</p></details>` chain has `</p>` kept on pass 1 and dropped on
    // pass 2, because the omission heuristic looks at surrounding bytes
    // and pass 1's whitespace strip changes what pass 2 sees. Since the
    // contract (matching sanitize and normalize) demands idempotence,
    // we trade the few-byte savings for stability.
    cfg.keep_closing_tags = true;
    // Same idempotence reasoning applies to <html> / <head> opening
    // tag omission: minify-html removes them based on attribute
    // presence + content cursor position, which can also flip between
    // passes when whitespace decisions cascade.
    cfg.keep_html_and_head_opening_tags = true;
    // Strip comments. Templates ship without functional comments — and
    // the sanitize pass already drops anything dangerous. The
    // `keep_ssi_comments` flag stays off (we don't have SSI in our
    // self-hosted stack).
    cfg.keep_comments = false;
    cfg.keep_ssi_comments = false;
    cfg.keep_input_type_text_attr = false;
    // Spec-permissive but browser-safe. These three flags push us past
    // the 20% reduction line on the starter pack while staying parseable
    // by every browser we ship to (every option marked "still parsed
    // correctly by almost all browsers" in the Cfg docstring):
    //   - allow_optimal_entities: collapse entity references where
    //     equivalent (`&amp;` → `&` in safe positions). Small but free.
    //   - allow_removing_spaces_between_attributes: drop redundant
    //     interstitial whitespace between attribute tokens.
    //   - minify_doctype: emit `<!doctypehtml>` instead of `<!doctype
    //     html>`. ~6 bytes per doc.
    cfg.allow_optimal_entities = true;
    cfg.allow_removing_spaces_between_attributes = true;
    cfg.minify_doctype = true;
    // The one flag we still keep off: aggressive unquoting of values
    // that contain spec-prohibited chars (parens, brackets). Tailwind
    // arbitrary-value classes like `bg-[rgba(15,15,15,0.72)]` rely on
    // quoted attrs — flipping this risks the kind of cross-browser
    // regression we'd discover way later. The spec-compliant unquote
    // path (default behavior) is already firing for safe values
    // (`charset=utf-8`, `lang=en`).
    cfg.allow_noncompliant_unquoted_attribute_values = false;
    cfg.remove_bangs = false;
    cfg.remove_processing_instructions = false;
    // We don't use template syntax inline; let any `{{`, `<%`, etc.
    // get parsed as content.
    cfg.preserve_brace_template_syntax = false;
    cfg.preserve_chevron_percent_template_syntax = false;
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_minifies_whitespace() {
        let html = "<p>  hello   world  </p>";
        let out = minify_html_for_publish(html).unwrap();
        assert!(out.len() < html.len());
        assert!(out.contains("hello"));
        assert!(out.contains("world"));
    }

    #[test]
    fn smoke_strips_html_comments() {
        let html = "<p>hi</p><!-- removeme --><p>bye</p>";
        let out = minify_html_for_publish(html).unwrap();
        assert!(!out.contains("removeme"));
        assert!(out.contains("hi"));
        assert!(out.contains("bye"));
    }

    #[test]
    fn smoke_minifies_inline_style_block() {
        // Inline CSS routed through lightningcss should collapse
        // whitespace between properties and around the colon/semicolon.
        let html = "<style>  body  {  color:  red ; background: blue; }  </style>";
        let out = minify_html_for_publish(html).unwrap();
        // Output should be tighter than input.
        assert!(out.len() < html.len(), "expected reduction, got: {}", out);
        // The selectors + properties must survive.
        assert!(out.contains("body"));
        assert!(out.contains("color"));
        assert!(out.contains("red"));
    }

    #[test]
    fn smoke_minifies_inline_style_attr() {
        // Inline `style="..."` also goes through lightningcss.
        let html = r#"<p style="color: red ; background: blue;">x</p>"#;
        let out = minify_html_for_publish(html).unwrap();
        // Whitespace inside the style value should collapse.
        assert!(!out.contains("color: red ;"), "got: {}", out);
        assert!(out.contains("color"));
        assert!(out.contains("red"));
    }

    #[test]
    fn smoke_preserves_quoted_class_with_brackets() {
        // Tailwind arbitrary-value classes contain brackets + commas.
        // The unquote-attr setting being off ensures these survive
        // quoted in output.
        let html = r#"<div class="bg-[rgba(15,15,15,0.72)] max-w-[1240px]">x</div>"#;
        let out = minify_html_for_publish(html).unwrap();
        assert!(out.contains("bg-[rgba(15,15,15,0.72)]"), "got: {}", out);
        assert!(out.contains("max-w-[1240px]"), "got: {}", out);
        // And the quotes must survive — otherwise the [, (, etc. would
        // be reinterpreted by some HTML parsers.
        assert!(
            out.contains("class=\""),
            "expected quoted class attr, got: {}",
            out
        );
    }

    #[test]
    fn idempotent_on_minified_output() {
        // The contract every other module of this crate honors: running
        // the pass on its own output is a no-op.
        let html = "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <title>x</title>\n  </head>\n  <body>\n    <p>  hi  </p>\n  </body>\n</html>\n";
        let r1 = minify_html_for_publish(html).unwrap();
        let r2 = minify_html_for_publish(&r1).unwrap();
        assert_eq!(r1, r2, "expected idempotence, got two distinct outputs");
    }

    #[test]
    fn empty_input_is_empty_output() {
        let r = minify_html_for_publish("").unwrap();
        assert_eq!(r, "");
    }

    #[test]
    fn preserves_doctype() {
        let html = "<!doctype html><html><body>x</body></html>";
        let out = minify_html_for_publish(html).unwrap();
        assert!(
            out.to_ascii_lowercase().contains("<!doctype"),
            "got: {}",
            out
        );
    }

    #[test]
    fn preserves_charset_meta() {
        let html =
            "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>x</body></html>";
        let out = minify_html_for_publish(html).unwrap();
        assert!(out.contains("charset"), "got: {}", out);
    }

    #[test]
    fn preserves_viewport_meta() {
        let html = "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body>x</body></html>";
        let out = minify_html_for_publish(html).unwrap();
        assert!(out.contains("viewport"), "got: {}", out);
        // Don't care about exact attribute formatting, as long as both
        // pieces of the content value are intact.
        assert!(out.contains("device-width"), "got: {}", out);
    }
}
