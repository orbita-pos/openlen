use openlen_html_engine::ops::apply::{apply_ops, Op, OpType};
use openlen_html_engine::ops::tagger::tag_with_op_ids;

fn tag(s: &str) -> String {
    tag_with_op_ids(s).unwrap().tagged_html
}

#[test]
fn empty_ops_returns_null_html() {
    let tagged = tag("<div>hi</div>");
    let r = apply_ops(&tagged, &[]);
    assert!(r.html.is_none());
    assert_eq!(r.applied_count, 0);
    assert!(r.errors.is_empty());
}

#[test]
fn replace_substitutes_outer_html() {
    let tagged = tag("<div><p>old</p></div>");
    // p has id "1" (div is "0").
    let ops = vec![Op {
        op_type: OpType::Replace,
        target: "1".to_string(),
        new_html: Some("<h1>new</h1>".to_string()),
    }];
    let r = apply_ops(&tagged, &ops);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 1);
    let html = r.html.unwrap();
    assert!(html.contains("<h1>new</h1>"));
    assert!(!html.contains("<p>old</p>"));
    assert!(!html.contains("data-op-id"));
}

#[test]
fn delete_removes_element() {
    let tagged = tag("<div><p>keep</p><span>drop</span></div>");
    // div=0, p=1, span=2
    let ops = vec![Op {
        op_type: OpType::Delete,
        target: "2".to_string(),
        new_html: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.applied_count, 1);
    let html = r.html.unwrap();
    assert!(html.contains("<p>keep</p>"));
    assert!(!html.contains("<span>drop</span>"));
}

#[test]
fn insert_before_prepends_sibling() {
    let tagged = tag("<div><p>x</p></div>");
    // div=0, p=1
    let ops = vec![Op {
        op_type: OpType::InsertBefore,
        target: "1".to_string(),
        new_html: Some("<hr>".to_string()),
    }];
    let r = apply_ops(&tagged, &ops);
    assert_eq!(r.errors.len(), 0);
    let html = r.html.unwrap();
    // <hr> appears before <p>
    let hr_idx = html.find("<hr>").expect("hr present");
    let p_idx = html.find("<p>x</p>").expect("p present");
    assert!(hr_idx < p_idx);
}

#[test]
fn insert_after_appends_sibling() {
    let tagged = tag("<div><p>x</p></div>");
    let ops = vec![Op {
        op_type: OpType::InsertAfter,
        target: "1".to_string(),
        new_html: Some("<hr>".to_string()),
    }];
    let r = apply_ops(&tagged, &ops);
    let html = r.html.unwrap();
    let hr_idx = html.find("<hr>").unwrap();
    let p_idx = html.find("<p>x</p>").unwrap();
    assert!(p_idx < hr_idx);
}

#[test]
fn validation_fails_on_missing_target() {
    let tagged = tag("<div>x</div>");
    let ops = vec![Op {
        op_type: OpType::Replace,
        target: "zzz".to_string(),
        new_html: Some("y".to_string()),
    }];
    let r = apply_ops(&tagged, &ops);
    assert!(r.html.is_none());
    assert_eq!(r.applied_count, 0);
    assert_eq!(r.errors.len(), 1);
    assert!(r.errors[0].reason.contains("doesn't exist"));
}

#[test]
fn validation_fails_on_empty_new_html() {
    let tagged = tag("<div>x</div>");
    let ops = vec![Op {
        op_type: OpType::Replace,
        target: "0".to_string(),
        new_html: Some("   ".to_string()),
    }];
    let r = apply_ops(&tagged, &ops);
    assert!(r.html.is_none());
    assert!(r.errors[0].reason.contains("non-empty <new>"));
}

#[test]
fn validation_passes_for_delete_without_new_html() {
    let tagged = tag("<div>x</div>");
    let ops = vec![Op {
        op_type: OpType::Delete,
        target: "0".to_string(),
        new_html: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.applied_count, 1);
}

#[test]
fn multiple_ops_apply_in_order() {
    let tagged = tag("<div><p>a</p><p>b</p><p>c</p></div>");
    // div=0, p=1,2,3
    let ops = vec![
        Op {
            op_type: OpType::Replace,
            target: "1".to_string(),
            new_html: Some("<h1>A</h1>".to_string()),
        },
        Op {
            op_type: OpType::Delete,
            target: "3".to_string(),
            new_html: None,
        },
    ];
    let r = apply_ops(&tagged, &ops);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.applied_count, 2);
    let html = r.html.unwrap();
    assert!(html.contains("<h1>A</h1>"));
    assert!(html.contains("<p>b</p>"));
    assert!(!html.contains("<p>c</p>"));
}

#[test]
fn cascade_on_same_target_records_warning() {
    let tagged = tag("<div><p>x</p></div>");
    let ops = vec![
        Op {
            op_type: OpType::Replace,
            target: "1".to_string(),
            new_html: Some("<h1>new</h1>".to_string()),
        },
        Op {
            op_type: OpType::Delete,
            target: "1".to_string(),
            new_html: None,
        },
    ];
    let r = apply_ops(&tagged, &ops);
    // Pre-validation passed (target exists once). Phase 2 applies first,
    // second cascades.
    assert_eq!(r.applied_count, 1);
    assert_eq!(r.errors.len(), 1);
    assert!(r.errors[0].reason.contains("unreachable"));
}

#[test]
fn op_id_stripped_after_apply() {
    let tagged = tag("<div><p>x</p></div>");
    let ops = vec![Op {
        op_type: OpType::InsertAfter,
        target: "1".to_string(),
        new_html: Some("<hr>".to_string()),
    }];
    let r = apply_ops(&tagged, &ops);
    let html = r.html.unwrap();
    assert!(!html.contains("data-op-id"));
}
