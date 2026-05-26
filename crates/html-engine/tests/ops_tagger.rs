use openlen_html_engine::ops::tagger::tag_with_op_ids;

#[test]
fn empty_input_returns_empty() {
    let r = tag_with_op_ids("").unwrap();
    assert_eq!(r.tagged_count, 0);
    assert_eq!(r.tagged_html, "");
}

#[test]
fn whitespace_only_returns_unchanged() {
    let r = tag_with_op_ids("   \n  ").unwrap();
    assert_eq!(r.tagged_count, 0);
}

#[test]
fn counts_addressable_elements() {
    let r = tag_with_op_ids("<div><p>hi</p><span>x</span></div>").unwrap();
    // div, p, span = 3 addressable elements.
    assert_eq!(r.tagged_count, 3);
    assert!(r.tagged_html.contains(r#"data-op-id="0""#));
    assert!(r.tagged_html.contains(r#"data-op-id="1""#));
    assert!(r.tagged_html.contains(r#"data-op-id="2""#));
}

#[test]
fn skips_head_metadata_and_void_tags() {
    let html = r#"<!doctype html><html><head><meta charset="utf-8"><title>x</title><link rel="stylesheet" href="a"><style>a{}</style><script>1</script></head><body><br><hr><p>hi</p></body></html>"#;
    let r = tag_with_op_ids(html).unwrap();
    // html/head/meta/title/link/style/script/body/br/hr all skipped — only <p> + <body>?
    // Actually <body> is NOT in skip set; only html/head + their metadata children + br/hr are.
    // So we tag body + p = 2.
    assert_eq!(r.tagged_count, 2);
    assert!(!r.tagged_html.contains(r#"<meta data-op-id"#));
    assert!(!r.tagged_html.contains(r#"<script data-op-id"#));
    assert!(!r.tagged_html.contains(r#"<style data-op-id"#));
    assert!(!r.tagged_html.contains(r#"<br data-op-id"#));
    assert!(!r.tagged_html.contains(r#"<hr data-op-id"#));
}

#[test]
fn preserves_existing_op_id() {
    let r = tag_with_op_ids(r#"<div data-op-id="legacy"><p>x</p></div>"#).unwrap();
    // div keeps its existing "legacy"; only p gets a fresh id.
    assert!(r.tagged_html.contains(r#"data-op-id="legacy""#));
    assert_eq!(r.tagged_count, 1);
}

#[test]
fn base36_sequence_continues_past_9() {
    // Build 12 nested divs → counter reaches 11 → ids 0..9, a, b.
    let mut nested = String::new();
    for _ in 0..12 {
        nested.push_str("<div>");
    }
    for _ in 0..12 {
        nested.push_str("</div>");
    }
    let r = tag_with_op_ids(&nested).unwrap();
    assert_eq!(r.tagged_count, 12);
    assert!(r.tagged_html.contains(r#"data-op-id="9""#));
    assert!(r.tagged_html.contains(r#"data-op-id="a""#));
    assert!(r.tagged_html.contains(r#"data-op-id="b""#));
}
