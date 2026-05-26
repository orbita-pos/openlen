use openlen_html_engine::ops::stripper::strip_op_ids;
use openlen_html_engine::ops::tagger::tag_with_op_ids;

#[test]
fn empty_in_empty_out() {
    assert_eq!(strip_op_ids(""), "");
}

#[test]
fn strips_single_id() {
    let stripped = strip_op_ids(r#"<div data-op-id="0">hi</div>"#);
    assert_eq!(stripped, "<div>hi</div>");
}

#[test]
fn strips_multiple_ids() {
    let stripped = strip_op_ids(
        r#"<div data-op-id="0"><p data-op-id="1">hi</p><span data-op-id="2a">x</span></div>"#,
    );
    assert!(!stripped.contains("data-op-id"));
    assert!(stripped.contains("<div>"));
    assert!(stripped.contains("<p>"));
    assert!(stripped.contains("<span>"));
}

#[test]
fn preserves_other_attributes() {
    let stripped = strip_op_ids(r#"<a href="x" data-op-id="0" class="btn">go</a>"#);
    assert!(stripped.contains(r#"href="x""#));
    assert!(stripped.contains(r#"class="btn""#));
    assert!(!stripped.contains("data-op-id"));
}

#[test]
fn tag_then_strip_round_trip() {
    let input = "<div><p>hi</p><span>x</span></div>";
    let tagged = tag_with_op_ids(input).unwrap().tagged_html;
    let stripped = strip_op_ids(&tagged);
    // After tag→strip we don't get byte-identical input (lol-html may
    // normalize quoting), but we should have lost no content and no op
    // markers remain.
    assert!(!stripped.contains("data-op-id"));
    assert!(stripped.contains("hi"));
    assert!(stripped.contains("x"));
    assert!(stripped.contains("<p>"));
}
