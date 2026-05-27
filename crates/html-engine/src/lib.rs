#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

pub mod error;
pub mod minify;
pub mod normalize;
pub mod ops;
pub mod parser;
pub mod sanitize;
pub mod stream;

use napi::Result;

use crate::ops::{apply, parse, resolver, scoped_view, stripper, tagger};

#[napi]
pub fn round_trip(html: String) -> Result<String> {
    parser::round_trip(&html).map_err(Into::into)
}

#[napi]
pub fn normalize_born_canonical(html: String) -> String {
    normalize::normalize_born_canonical(&html)
}

#[napi(object, js_name = "SanitizeRemovedCounts")]
pub struct JsSanitizeRemovedCounts {
    pub scripts: u32,
    pub event_handlers: u32,
    pub dangerous_urls: u32,
    pub iframes: u32,
    pub meta_refresh: u32,
}

#[napi(object, js_name = "SanitizeResult")]
pub struct JsSanitizeResult {
    /// Sanitized HTML when the slot-path gate passes; absent on a slot-path
    /// detection. Callers MUST treat absence as a publish-block.
    pub html: Option<String>,
    /// Position-tagged reasons when the gate fires. Empty on success.
    pub errors: Vec<String>,
    /// Counts of silently-stripped XSS-shaped content (telemetry only).
    pub removed: JsSanitizeRemovedCounts,
}

#[napi(object, js_name = "OptimizeStats")]
pub struct JsOptimizeStats {
    pub bytes_in: u32,
    pub bytes_out: u32,
    pub css_inlined: bool,
    pub tailwind_classes_kept: u32,
}

#[napi(object, js_name = "OptimizeResult")]
pub struct JsOptimizeResult {
    /// Minified HTML when the gate passes; absent on a slot-path
    /// detection (caller must treat as a publish-block).
    pub html: Option<String>,
    /// Position-tagged reasons when the gate fires. Empty on success.
    pub errors: Vec<String>,
    pub stats: JsOptimizeStats,
}

#[napi]
pub fn optimize_for_publish(html: String) -> JsOptimizeResult {
    let r = minify::optimize_for_publish(&html);
    JsOptimizeResult {
        html: r.html,
        errors: r.errors,
        stats: JsOptimizeStats {
            bytes_in: r.stats.bytes_in,
            bytes_out: r.stats.bytes_out,
            css_inlined: r.stats.css_inlined,
            tailwind_classes_kept: r.stats.tailwind_classes_kept,
        },
    }
}

#[napi]
pub fn sanitize_for_publish(html: String) -> JsSanitizeResult {
    let r = sanitize::sanitize_for_publish(&html);
    JsSanitizeResult {
        html: r.html,
        errors: r.errors,
        removed: JsSanitizeRemovedCounts {
            scripts: r.removed.scripts,
            event_handlers: r.removed.event_handlers,
            dangerous_urls: r.removed.dangerous_urls,
            iframes: r.removed.iframes,
            meta_refresh: r.removed.meta_refresh,
        },
    }
}

#[napi(object, js_name = "TaggedHtmlResult")]
pub struct JsTaggedHtmlResult {
    pub tagged_html: String,
    pub tagged_count: u32,
}

#[napi]
pub fn tag_with_op_ids(html: String) -> Result<JsTaggedHtmlResult> {
    let r = tagger::tag_with_op_ids(&html)?;
    Ok(JsTaggedHtmlResult {
        tagged_html: r.tagged_html,
        tagged_count: r.tagged_count,
    })
}

#[napi]
pub fn strip_op_ids(html: String) -> String {
    stripper::strip_op_ids(&html)
}

#[napi(object, js_name = "Op")]
pub struct JsOp {
    #[napi(js_name = "type")]
    pub op_type: String,
    pub target: String,
    pub new_html: Option<String>,
}

#[napi(object, js_name = "ParseResult")]
pub struct JsParseResult {
    pub ops: Vec<JsOp>,
    pub errors: Vec<String>,
}

#[napi]
pub fn parse_ops(raw_html: String) -> JsParseResult {
    let r = parse::parse_ops(&raw_html);
    JsParseResult {
        ops: r
            .ops
            .into_iter()
            .map(|o| JsOp {
                op_type: o.op_type.as_str().to_string(),
                target: o.target,
                new_html: o.new_html,
            })
            .collect(),
        errors: r.errors,
    }
}

#[napi(object, js_name = "ApplyError")]
pub struct JsApplyError {
    pub op_index: u32,
    #[napi(js_name = "op")]
    pub op_type: String,
    pub target: String,
    pub reason: String,
}

#[napi(object, js_name = "ApplyResult")]
pub struct JsApplyResult {
    pub html: Option<String>,
    pub errors: Vec<JsApplyError>,
    pub applied_count: u32,
}

#[napi]
pub fn apply_ops(tagged_html: String, ops: Vec<JsOp>) -> JsApplyResult {
    let mut native_ops: Vec<apply::Op> = Vec::with_capacity(ops.len());
    let mut errors: Vec<JsApplyError> = Vec::new();
    for (i, o) in ops.iter().enumerate() {
        match apply::OpType::parse(&o.op_type) {
            Some(t) => native_ops.push(apply::Op {
                op_type: t,
                target: o.target.clone(),
                new_html: o.new_html.clone(),
            }),
            None => errors.push(JsApplyError {
                op_index: i as u32,
                op_type: o.op_type.clone(),
                target: o.target.clone(),
                reason: format!("Unknown op type \"{}\"", o.op_type),
            }),
        }
    }
    if !errors.is_empty() {
        return JsApplyResult {
            html: None,
            errors,
            applied_count: 0,
        };
    }
    let r = apply::apply_ops(&tagged_html, &native_ops);
    JsApplyResult {
        html: r.html,
        errors: r
            .errors
            .into_iter()
            .map(|e| JsApplyError {
                op_index: e.op_index,
                op_type: e.op_type.as_str().to_string(),
                target: e.target,
                reason: e.reason,
            })
            .collect(),
        applied_count: r.applied_count,
    }
}

#[napi]
pub fn resolve_op_id_by_path(tagged_html: String, path: String) -> Option<String> {
    resolver::resolve_op_id_by_path(&tagged_html, &path)
}

#[napi(object, js_name = "ScopedView")]
pub struct JsScopedView {
    pub scoped_html: String,
    pub container_op_id: String,
    pub outline: String,
    pub pin_is_container: bool,
}

#[napi]
pub fn build_scoped_view(tagged_html: String, pinned_op_id: String) -> Option<JsScopedView> {
    scoped_view::build_scoped_view(&tagged_html, &pinned_op_id).map(|v| JsScopedView {
        scoped_html: v.scoped_html,
        container_op_id: v.container_op_id,
        outline: v.outline,
        pin_is_container: v.pin_is_container,
    })
}
