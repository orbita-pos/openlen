// Idempotence stress tests for optimize_for_publish.
//
// Stronger than the starter-pack idempotence check in
// optimize_starters.rs — this covers shapes that historically broke
// minify-html's optional-closing-tag heuristic (e.g. `</p></details>`
// where omission decisions cascade across passes).
//
// All tests follow the same contract: `optimize(optimize(x)).html ==
// optimize(x).html`. The session-4 sweep landed
// keep_closing_tags = true + keep_html_and_head_opening_tags = true to
// guarantee this; if any of these tests start failing, the regression
// is in that Cfg choice (see crates/html-engine/src/minify/html.rs).

use openlen_html_engine::minify::optimize_for_publish;

fn opt(html: &str) -> String {
    optimize_for_publish(html)
        .html
        .expect("optimize must not hard-reject these inputs")
}

fn assert_idempotent(label: &str, html: &str) {
    let r1 = opt(html);
    let r2 = opt(&r1);
    assert_eq!(r1, r2, "{} idempotence broken", label);
}

#[test]
fn idempotent_simple_doc() {
    assert_idempotent(
        "simple-doc",
        "<!doctype html><html><head><title>x</title></head><body><p>hi</p></body></html>",
    );
}

#[test]
fn idempotent_with_optional_closing_tags() {
    // The exact shape that broke minify-html v0.16 before we set
    // keep_closing_tags=true: `</p>` immediately followed by `</details>`
    // gets pass-1-kept and pass-2-dropped because the omission
    // heuristic looks at surrounding whitespace bytes which pass 1
    // changes. Locking keep_closing_tags=true makes both passes agree.
    assert_idempotent(
        "p-inside-details",
        "<details><summary>q</summary><p>This is a paragraph.</p></details>",
    );
}

#[test]
fn idempotent_with_inline_style_attr() {
    // Inline style="..." goes through lightningcss inside minify-html.
    // lightningcss is itself idempotent, so the chain holds.
    assert_idempotent(
        "inline-style-attr",
        r#"<p style="color: red; font-size: 14px; background: #fff;">x</p>"#,
    );
}

#[test]
fn idempotent_with_inline_style_block() {
    assert_idempotent(
        "inline-style-block",
        "<style>body { color: red; } a:hover { color: blue; }</style>",
    );
}

#[test]
fn idempotent_with_inline_script_block() {
    // minify_js is off, so the script body should round-trip
    // byte-for-byte after pass 1.
    assert_idempotent(
        "inline-script",
        "<script>const x = 1; const y = 2; console.log(x + y);</script>",
    );
}

#[test]
fn idempotent_with_meta_charset_and_viewport() {
    assert_idempotent(
        "meta-charset-viewport",
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>x</title></head><body>x</body></html>"#,
    );
}

#[test]
fn idempotent_with_tailwind_arbitrary_classes() {
    assert_idempotent(
        "tailwind-arbitrary",
        r#"<div class="bg-[rgba(15,15,15,0.72)] max-w-[1240px] text-[color:var(--fg-dim)] grid-cols-[1fr_2fr]"><p>x</p></div>"#,
    );
}

#[test]
fn idempotent_with_nested_form_controls() {
    // Nested form/fieldset/legend exercise minify-html's whitespace
    // handling around block-level elements — a historically fragile
    // area for HTML minifiers.
    assert_idempotent(
        "nested-form",
        "<form><fieldset><legend>x</legend><input type=\"text\" name=\"q\"></fieldset></form>",
    );
}

#[test]
fn idempotent_with_table() {
    // Tables include optional closing tags (`</td>`, `</tr>`, `</tbody>`)
    // which the closing-tag-omission heuristic loves to over-collapse.
    // With keep_closing_tags=true these come out stable.
    assert_idempotent(
        "table",
        "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
}

#[test]
fn idempotent_with_svg_inline() {
    // Inline SVG (used by our Lucide icons) must round-trip unchanged.
    assert_idempotent(
        "inline-svg",
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M4 4 L20 20" stroke="currentColor" fill="none"/></svg>"#,
    );
}

#[test]
fn idempotent_with_html5_doctype_lowercase() {
    assert_idempotent(
        "lowercase-doctype",
        "<!doctype html><html><body>x</body></html>",
    );
}

#[test]
fn idempotent_with_html5_doctype_uppercase() {
    assert_idempotent(
        "uppercase-doctype",
        "<!DOCTYPE html><html><body>x</body></html>",
    );
}

#[test]
fn idempotent_with_utf8_content() {
    // OpenLen renders accented copy in pitch/description fields. The
    // minify pass must not mangle multi-byte UTF-8 sequences.
    assert_idempotent(
        "utf8",
        "<p>Diseño rápido — la <em>página</em> ya está lista. 日本語 also OK.</p>",
    );
}

#[test]
fn idempotent_with_html_comment_to_strip() {
    // After strip, second pass has nothing to remove. Output is stable.
    assert_idempotent(
        "comment-to-strip",
        "<p>hi</p><!-- gone after pass 1 --><p>bye</p>",
    );
}

#[test]
fn idempotent_with_consecutive_whitespace() {
    assert_idempotent("whitespace", "<p>   line one   \n\n  line two  </p>");
}
