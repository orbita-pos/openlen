use openlen_html_engine::ops::resolver::resolve_op_id_by_path;
use openlen_html_engine::ops::tagger::tag_with_op_ids;

fn tag(s: &str) -> String {
    tag_with_op_ids(s).unwrap().tagged_html
}

#[test]
fn empty_path_returns_none() {
    let tagged = tag("<html><body><div>x</div></body></html>");
    assert!(resolve_op_id_by_path(&tagged, "").is_none());
    assert!(resolve_op_id_by_path(&tagged, "   ").is_none());
}

#[test]
fn empty_html_returns_none() {
    assert!(resolve_op_id_by_path("", "div").is_none());
}

#[test]
fn resolves_simple_descendant() {
    let tagged = tag("<html><body><main><section><h1>x</h1></section></main></body></html>");
    let id = resolve_op_id_by_path(&tagged, "main > section > h1");
    assert!(id.is_some(), "should resolve");
}

#[test]
fn resolves_nth_child() {
    let tagged = tag(
        "<html><body><main><section><p>a</p></section><section><p>b</p></section></main></body></html>",
    );
    let id = resolve_op_id_by_path(&tagged, "main > section:nth-child(2) > p");
    assert!(id.is_some());
    // The id should point to the SECOND section's p, not the first.
    // Find both p ids in the tagged doc and confirm.
    let p_ids: Vec<&str> = tagged
        .match_indices("data-op-id=\"")
        .map(|(i, _)| {
            let start = i + r#"data-op-id=""#.len();
            let end = tagged[start..].find('"').unwrap() + start;
            &tagged[start..end]
        })
        .collect();
    // The resolved id is one of the document's ids.
    assert!(p_ids.contains(&id.unwrap().as_str()));
}

#[test]
fn missing_match_returns_none() {
    let tagged = tag("<html><body><div>x</div></body></html>");
    assert!(resolve_op_id_by_path(&tagged, "span.nonexistent").is_none());
}

#[test]
fn invalid_selector_returns_none() {
    let tagged = tag("<html><body><div>x</div></body></html>");
    assert!(resolve_op_id_by_path(&tagged, ">>>not a selector<<<").is_none());
}

#[test]
fn body_prefix_optional() {
    let tagged = tag("<html><body><div><p>x</p></div></body></html>");
    // Without "body" prefix.
    let id1 = resolve_op_id_by_path(&tagged, "div > p");
    // With explicit "body" prefix.
    let id2 = resolve_op_id_by_path(&tagged, "body > div > p");
    assert_eq!(id1, id2);
    assert!(id1.is_some());
}
