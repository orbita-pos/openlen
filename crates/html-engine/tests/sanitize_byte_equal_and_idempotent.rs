// Byte-equal and idempotence invariants for sanitize_for_publish. The three
// starter templates (mirror, manuscript, counter) are known-clean and the
// sanitizer must pass them through unmodified. Idempotence runs on both the
// clean and a deliberately-dirty input, asserting `sanitize(sanitize(x)) ==
// sanitize(x)`.

use std::fs;
use std::path::PathBuf;

use openlen_html_engine::sanitize::sanitize_for_publish;

fn starter(template: &str) -> String {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p.push(template);
    fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {}", p.display(), e))
}

// Byte-equal on the starters that are sanitize-clean (no inline scripts,
// no dangerous elements). The Tailwind CDN script in each starter is
// whitelisted and survives. Mirror has an additional inline sparkline
// script and is tested separately below.
fn byte_equal_clean_starter(template: &str) {
    let src = starter(template);
    let r = sanitize_for_publish(&src);
    assert!(
        r.errors.is_empty(),
        "starter {} had sanitize errors: {:?}",
        template,
        r.errors
    );
    let out = r
        .html
        .as_deref()
        .expect("starter must not be hard-rejected");
    assert_eq!(out, src, "byte-equal regression on {}", template);
    assert_eq!(
        r.removed.scripts, 0,
        "starter {} should not strip scripts",
        template
    );
    assert_eq!(
        r.removed.iframes, 0,
        "starter {} should not strip iframes",
        template
    );
    assert_eq!(r.removed.event_handlers, 0, "starter {} handlers", template);
    assert_eq!(r.removed.dangerous_urls, 0, "starter {} urls", template);
    assert_eq!(
        r.removed.meta_refresh, 0,
        "starter {} meta refresh",
        template
    );
}

#[test]
fn byte_equal_counter() {
    byte_equal_clean_starter("counter.html");
}

#[test]
fn byte_equal_manuscript() {
    byte_equal_clean_starter("manuscript.html");
}

#[test]
fn mirror_inline_sparkline_script_stripped_idempotently() {
    // mirror.html ships an inline `<script>` (procedural sparklines) that is
    // NOT on the whitelist. The sanitizer strips it. Byte-equal against src
    // therefore can't hold; what MUST hold is: (a) the strip is acknowledged
    // in `removed.scripts`, (b) the Tailwind CDN script survives, (c) running
    // sanitize again on the output is a no-op (idempotence + clean output).
    let src = starter("mirror.html");
    let r1 = sanitize_for_publish(&src);
    assert!(
        r1.errors.is_empty(),
        "mirror sanitize errors: {:?}",
        r1.errors
    );
    let s1 = r1.html.expect("mirror must not be hard-rejected");
    assert!(
        r1.removed.scripts >= 1,
        "expected the inline sparkline script to be stripped"
    );
    assert!(
        s1.contains("https://cdn.tailwindcss.com"),
        "Tailwind CDN script must be preserved"
    );
    assert!(
        !contains_inline_script(&s1),
        "no inline scripts should remain"
    );

    let r2 = sanitize_for_publish(&s1);
    let s2 = r2.html.expect("second pass must succeed");
    assert_eq!(s1, s2, "sanitize must be idempotent on mirror");
    assert_eq!(r2.removed.scripts, 0, "no scripts to strip on second pass");
}

// True iff `out` contains a <script> tag whose src isn't the whitelisted
// Tailwind CDN. Crude scan — sufficient for the post-sanitize invariant.
fn contains_inline_script(out: &str) -> bool {
    let lower = out.to_ascii_lowercase();
    let mut cursor = 0;
    while let Some(rel) = lower[cursor..].find("<script") {
        let start = cursor + rel;
        // Find the end of the opening tag.
        let tag_end = lower[start..]
            .find('>')
            .map(|e| start + e + 1)
            .unwrap_or(out.len());
        let tag = &lower[start..tag_end];
        if tag.contains("src=\"https://cdn.tailwindcss.com")
            || tag.contains("src='https://cdn.tailwindcss.com")
        {
            cursor = tag_end;
            continue;
        }
        return true;
    }
    false
}

#[test]
fn idempotent_mirror() {
    let src = starter("mirror.html");
    let r1 = sanitize_for_publish(&src).html.unwrap();
    let r2 = sanitize_for_publish(&r1).html.unwrap();
    assert_eq!(r1, r2);
}

#[test]
fn idempotent_counter() {
    let src = starter("counter.html");
    let r1 = sanitize_for_publish(&src).html.unwrap();
    let r2 = sanitize_for_publish(&r1).html.unwrap();
    assert_eq!(r1, r2);
}

#[test]
fn idempotent_manuscript() {
    let src = starter("manuscript.html");
    let r1 = sanitize_for_publish(&src).html.unwrap();
    let r2 = sanitize_for_publish(&r1).html.unwrap();
    assert_eq!(r1, r2);
}

#[test]
fn idempotent_dirty_input() {
    // After the first sanitize pass, all the scriptable bits are gone, so a
    // second pass should be a true no-op (byte-equal + zero counts).
    let dirty = r#"<div>
<script>alert(1)</script>
<iframe></iframe>
<a href="javascript:x()" onclick="y()">z</a>
<meta http-equiv="refresh" content="0">
</div>"#;
    let r1 = sanitize_for_publish(dirty);
    let s1 = r1.html.unwrap();
    let r2 = sanitize_for_publish(&s1);
    let s2 = r2.html.unwrap();
    assert_eq!(s1, s2, "dirty idempotence broken");
    assert_eq!(r2.removed.scripts, 0);
    assert_eq!(r2.removed.event_handlers, 0);
    assert_eq!(r2.removed.dangerous_urls, 0);
    assert_eq!(r2.removed.iframes, 0);
    assert_eq!(r2.removed.meta_refresh, 0);
}

#[test]
fn empty_input_byte_equal() {
    let r = sanitize_for_publish("");
    assert_eq!(r.html.as_deref(), Some(""));
    assert!(r.errors.is_empty());
}

#[test]
fn whitespace_only_byte_equal() {
    let r = sanitize_for_publish("   \n\t   ");
    assert_eq!(r.html.as_deref(), Some("   \n\t   "));
}
