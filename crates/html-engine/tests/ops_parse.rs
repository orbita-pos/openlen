use openlen_html_engine::ops::apply::OpType;
use openlen_html_engine::ops::parse::parse_ops;

#[test]
fn empty_returns_error() {
    let r = parse_ops("");
    assert!(r.ops.is_empty());
    assert!(!r.errors.is_empty());
}

#[test]
fn no_edits_block_falls_back() {
    let r = parse_ops("<div>random html</div>");
    assert!(r.ops.is_empty());
    assert_eq!(r.errors.len(), 1);
    assert!(r.errors[0].contains("No <edits>"));
}

#[test]
fn self_closing_delete() {
    let r = parse_ops(r#"<edits><edit op="delete" target="a"/></edits>"#);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.ops.len(), 1);
    assert_eq!(r.ops[0].op_type, OpType::Delete);
    assert_eq!(r.ops[0].target, "a");
    assert!(r.ops[0].new_html.is_none());
}

#[test]
fn open_close_replace_with_new_wrapper() {
    let r = parse_ops(
        r#"<edits><edit op="replace" target="b"><new><h1>Title</h1></new></edit></edits>"#,
    );
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.ops.len(), 1);
    assert_eq!(r.ops[0].op_type, OpType::Replace);
    assert_eq!(r.ops[0].new_html.as_deref(), Some("<h1>Title</h1>"));
}

#[test]
fn open_close_replace_natural_form() {
    // Kimi's preferred natural form (no <new> wrapper).
    let r = parse_ops(r#"<edits><edit op="replace" target="b"><h1>Title</h1></edit></edits>"#);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.ops.len(), 1);
    assert_eq!(r.ops[0].new_html.as_deref(), Some("<h1>Title</h1>"));
}

#[test]
fn insert_before_and_after() {
    let r = parse_ops(
        r#"<edits>
          <edit op="insert_before" target="a"><div>top</div></edit>
          <edit op="insert_after" target="b"><div>bot</div></edit>
        </edits>"#,
    );
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.ops.len(), 2);
    assert_eq!(r.ops[0].op_type, OpType::InsertBefore);
    assert_eq!(r.ops[1].op_type, OpType::InsertAfter);
}

#[test]
fn empty_new_content_errors() {
    let r = parse_ops(r#"<edits><edit op="replace" target="a"></edit></edits>"#);
    assert_eq!(r.ops.len(), 0);
    assert!(r.errors.iter().any(|e| e.contains("empty content")));
}

#[test]
fn missing_target_errors() {
    let r = parse_ops(r#"<edits><edit op="replace"><div>x</div></edit></edits>"#);
    assert!(r.errors.iter().any(|e| e.contains("missing op or target")));
}

#[test]
fn self_closing_with_non_delete_op_errors() {
    let r = parse_ops(r#"<edits><edit op="replace" target="a"/></edits>"#);
    assert!(r.errors.iter().any(|e| e.contains("self-closing")));
}

#[test]
fn unknown_op_type_errors() {
    let r = parse_ops(r#"<edits><edit op="rotate" target="a"><div>x</div></edit></edits>"#);
    assert!(r.errors.iter().any(|e| e.contains("Unknown op type")));
}
