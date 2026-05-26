use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use lol_html::html_content::ContentType;
use lol_html::{element, rewrite_str, RewriteStrSettings};

use super::OP_ID_ATTR;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpType {
    Replace,
    InsertBefore,
    InsertAfter,
    Delete,
}

impl OpType {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "replace" => Self::Replace,
            "insert_before" => Self::InsertBefore,
            "insert_after" => Self::InsertAfter,
            "delete" => Self::Delete,
            _ => return None,
        })
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Replace => "replace",
            Self::InsertBefore => "insert_before",
            Self::InsertAfter => "insert_after",
            Self::Delete => "delete",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Op {
    pub op_type: OpType,
    pub target: String,
    pub new_html: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ApplyError {
    pub op_index: u32,
    pub op_type: OpType,
    pub target: String,
    pub reason: String,
}

#[derive(Debug)]
pub struct ApplyResult {
    pub html: Option<String>,
    pub errors: Vec<ApplyError>,
    pub applied_count: u32,
}

/// Apply ops in emission order against a tagged HTML document. Phase 1
/// validates every target exists exactly once in the ORIGINAL document
/// before any mutation; any validation error bails the whole batch (no
/// partial-apply). Phase 2 is best-effort — a delete that nukes an
/// ancestor of a later op is recorded as a cascade warning, never aborts.
/// Returns the spliced doc with `data-op-id` attributes stripped.
pub fn apply_ops(tagged_html: &str, ops: &[Op]) -> ApplyResult {
    if ops.is_empty() {
        return ApplyResult {
            html: None,
            errors: vec![],
            applied_count: 0,
        };
    }

    let present = match collect_op_id_counts(tagged_html) {
        Ok(m) => m,
        Err(e) => {
            return ApplyResult {
                html: None,
                errors: vec![ApplyError {
                    op_index: 0,
                    op_type: OpType::Replace,
                    target: String::new(),
                    reason: format!("scan failed: {}", e),
                }],
                applied_count: 0,
            };
        }
    };

    let mut errors: Vec<ApplyError> = Vec::new();
    for (i, op) in ops.iter().enumerate() {
        let count = present.get(&op.target).copied().unwrap_or(0);
        if count == 0 {
            errors.push(ApplyError {
                op_index: i as u32,
                op_type: op.op_type,
                target: op.target.clone(),
                reason: format!(
                    "No element with {}=\"{}\" — model addressed an ID that doesn't exist in the document.",
                    OP_ID_ATTR, op.target
                ),
            });
        } else if count > 1 {
            errors.push(ApplyError {
                op_index: i as u32,
                op_type: op.op_type,
                target: op.target.clone(),
                reason: format!(
                    "Multiple elements with {}=\"{}\" — tagging invariant violated.",
                    OP_ID_ATTR, op.target
                ),
            });
        }
        if op.op_type != OpType::Delete && op.new_html.as_ref().is_none_or(|s| s.trim().is_empty())
        {
            errors.push(ApplyError {
                op_index: i as u32,
                op_type: op.op_type,
                target: op.target.clone(),
                reason: "Op needs non-empty <new> content".to_string(),
            });
        }
    }

    if !errors.is_empty() {
        return ApplyResult {
            html: None,
            errors,
            applied_count: 0,
        };
    }

    // Phase 2 — bucket ops by target so multiple ops on the same id can be
    // processed in emission order during the single element-handler call.
    let mut by_target: HashMap<String, Vec<(u32, Op)>> = HashMap::new();
    for (i, op) in ops.iter().enumerate() {
        by_target
            .entry(op.target.clone())
            .or_default()
            .push((i as u32, op.clone()));
    }

    let applied = Cell::new(0u32);
    let cascade: RefCell<Vec<ApplyError>> = RefCell::new(Vec::new());

    let rewrite = rewrite_str(
        tagged_html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("[data-op-id]", |el| {
                let id = el.get_attribute(OP_ID_ATTR).unwrap_or_default();
                if let Some(op_list) = by_target.get(id.as_str()) {
                    let mut killed = false;
                    for (idx, op) in op_list {
                        if killed {
                            cascade.borrow_mut().push(ApplyError {
                                op_index: *idx,
                                op_type: op.op_type,
                                target: op.target.clone(),
                                reason: "Target became unreachable after earlier ops (likely an ancestor was deleted).".to_string(),
                            });
                            continue;
                        }
                        let content = op.new_html.as_deref().unwrap_or("");
                        match op.op_type {
                            OpType::Replace => {
                                el.replace(content, ContentType::Html);
                                killed = true;
                            }
                            OpType::InsertBefore => {
                                el.before(content, ContentType::Html);
                            }
                            OpType::InsertAfter => {
                                el.after(content, ContentType::Html);
                            }
                            OpType::Delete => {
                                el.remove();
                                killed = true;
                            }
                        }
                        applied.set(applied.get() + 1);
                    }
                }
                el.remove_attribute(OP_ID_ATTR);
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    );

    let html = match rewrite {
        Ok(s) => s,
        Err(e) => {
            return ApplyResult {
                html: None,
                errors: vec![ApplyError {
                    op_index: 0,
                    op_type: OpType::Replace,
                    target: String::new(),
                    reason: format!("rewrite failed: {}", e),
                }],
                applied_count: 0,
            };
        }
    };

    ApplyResult {
        html: Some(html),
        errors: cascade.into_inner(),
        applied_count: applied.get(),
    }
}

fn collect_op_id_counts(html: &str) -> Result<HashMap<String, u32>, String> {
    let counts: RefCell<HashMap<String, u32>> = RefCell::new(HashMap::new());
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("[data-op-id]", |el| {
                let id = el.get_attribute(OP_ID_ATTR).unwrap_or_default();
                *counts.borrow_mut().entry(id).or_insert(0) += 1;
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(counts.into_inner())
}
