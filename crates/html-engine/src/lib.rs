#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

pub mod error;
pub mod minify;
pub mod normalize;
pub mod ops;
pub mod parser;
pub mod publish;
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

// ─── publish-time helpers (F1.5) ──────────────────────────────────────────────

#[napi(object, js_name = "ExtractedLogo")]
pub struct JsExtractedLogo {
    pub href: String,
    pub is_data_uri: bool,
}

#[napi]
pub fn extract_logo(html: String) -> Option<JsExtractedLogo> {
    publish::extract_logo(&html).map(|l| JsExtractedLogo {
        href: l.href,
        is_data_uri: l.is_data_uri,
    })
}

#[napi]
pub fn inject_logo(html: String, logo_url: String) -> String {
    publish::inject_logo(&html, &logo_url)
}

#[napi(object, js_name = "UnsplashCredit")]
pub struct JsUnsplashCredit {
    pub author: String,
    pub author_url: String,
}

#[napi(object, js_name = "ConsolidationResult")]
pub struct JsConsolidationResult {
    pub html: String,
    pub credits: Vec<JsUnsplashCredit>,
    pub anonymous_unsplash_count: u32,
}

#[napi]
pub fn consolidate_unsplash_credits(html: String) -> JsConsolidationResult {
    let r = publish::consolidate_unsplash_credits(&html);
    JsConsolidationResult {
        html: r.html,
        credits: r
            .credits
            .into_iter()
            .map(|c| JsUnsplashCredit {
                author: c.author,
                author_url: c.author_url,
            })
            .collect(),
        anonymous_unsplash_count: r.anonymous_unsplash_count,
    }
}

#[napi(object, js_name = "WireFormConfig")]
pub struct JsWireFormConfig {
    pub index: u32,
    pub success_message: Option<String>,
    pub redirect_url: Option<String>,
}

#[napi]
pub fn wire_published_forms(
    html: String,
    action: String,
    configs: Vec<JsWireFormConfig>,
) -> String {
    let native_configs: Vec<publish::FormConfig> = configs
        .into_iter()
        .map(|c| publish::FormConfig {
            index: c.index,
            success_message: c.success_message,
            redirect_url: c.redirect_url,
        })
        .collect();
    publish::wire_published_forms(&html, &action, &native_configs)
}

#[napi(object, js_name = "ResponsiveImageEntry")]
pub struct JsResponsiveImageEntry {
    /// Entity-decoded `src` attribute value this entry applies to.
    pub src: String,
    /// Largest local variant — becomes the new `src`.
    pub fallback_src: String,
    /// Complete srcset value, e.g. `/assets/ab12-400w.webp 400w, …`.
    pub srcset: String,
    pub width: u32,
    pub height: u32,
    /// AVIF srcset (same widths), present → the <img> is wrapped in <picture>
    /// with an AVIF <source> + WebP fallback. Absent → WebP <img srcset> path.
    pub avif_srcset: Option<String>,
}

#[napi(object, js_name = "RewriteImagesResult")]
pub struct JsRewriteImagesResult {
    pub html: String,
    pub rewritten: u32,
    pub lazied: u32,
    pub hero_src: Option<String>,
}

#[napi]
pub fn rewrite_responsive_images(
    html: String,
    images: Vec<JsResponsiveImageEntry>,
) -> JsRewriteImagesResult {
    let native: Vec<publish::ResponsiveImage> = images
        .into_iter()
        .map(|i| publish::ResponsiveImage {
            src: i.src,
            fallback_src: i.fallback_src,
            srcset: i.srcset,
            width: i.width,
            height: i.height,
            avif_srcset: i.avif_srcset,
        })
        .collect();
    let r = publish::rewrite_responsive_images(&html, &native);
    JsRewriteImagesResult {
        html: r.html,
        rewritten: r.rewritten,
        lazied: r.lazied,
        hero_src: r.hero_src,
    }
}

#[napi(object, js_name = "SealResult")]
pub struct JsSealResult {
    pub html: String,
    /// True when the CSP meta is present in the output.
    pub sealed: bool,
    /// `'sha256-…'` source tokens, one per unique inline script.
    pub script_hashes: Vec<String>,
    /// Origins of external <script src> elements.
    pub external_scripts: Vec<String>,
    pub bases_stripped: u32,
    pub noopener_added: u32,
    pub errors: Vec<String>,
}

#[napi]
pub fn seal_release(html: String, form_action_extra: Option<String>) -> JsSealResult {
    let r = publish::seal_release(&html, form_action_extra.as_deref());
    JsSealResult {
        html: r.html,
        sealed: r.sealed,
        script_hashes: r.script_hashes,
        external_scripts: r.external_scripts,
        bases_stripped: r.bases_stripped,
        noopener_added: r.noopener_added,
        errors: r.errors,
    }
}

#[napi]
pub fn extract_translatables(html: String) -> Vec<String> {
    publish::extract_translatables(&html)
}

#[napi(object, js_name = "PhotoSlot")]
pub struct JsPhotoSlot {
    pub subject: String,
    pub has_text: bool,
}

#[napi]
pub fn extract_photo_slots(html: String) -> Vec<JsPhotoSlot> {
    publish::extract_photo_slots(&html)
        .into_iter()
        .map(|s| JsPhotoSlot {
            subject: s.subject,
            has_text: s.has_text,
        })
        .collect()
}

#[napi(object, js_name = "PhotoAssignment")]
pub struct JsPhotoAssignment {
    /// Largest variant → the `src`. Empty string = leave this slot untouched.
    pub src: String,
    pub srcset: String,
    pub alt: String,
}

#[napi(object, js_name = "PhotoApplyResult")]
pub struct JsPhotoApplyResult {
    pub html: String,
    pub applied: u32,
}

#[napi]
pub fn apply_photo_slots(html: String, assignments: Vec<JsPhotoAssignment>) -> JsPhotoApplyResult {
    let native: Vec<publish::PhotoAssignment> = assignments
        .into_iter()
        .map(|a| publish::PhotoAssignment {
            src: a.src,
            srcset: a.srcset,
            alt: a.alt,
        })
        .collect();
    let r = publish::apply_photo_slots(&html, &native);
    JsPhotoApplyResult {
        html: r.html,
        applied: r.applied,
    }
}

#[napi]
pub fn reinject_translatables(html: String, texts: Vec<String>, lang: String) -> Option<String> {
    publish::reinject_translatables(&html, &texts, &lang)
}

// ─── Quality S1: visual-quality hardening ─────────────────────────────────────

#[napi(object, js_name = "HardenCounts")]
pub struct JsHardenCounts {
    pub white_alpha_capped: u32,
    pub black_alpha_capped: u32,
    pub tailwind_white_normalized: u32,
    pub tailwind_black_normalized: u32,
}

#[napi(object, js_name = "HardenWarning")]
pub struct JsHardenWarning {
    /// "banned_phrase" | "generic_cta" | "copied_section"
    pub kind: String,
    pub matched: String,
}

#[napi(object, js_name = "HardenResult")]
pub struct JsHardenResult {
    pub html: String,
    pub counts: JsHardenCounts,
    pub warnings: Vec<JsHardenWarning>,
}

#[napi]
pub fn harden_visual_quality(html: String) -> JsHardenResult {
    let r = publish::harden_visual_quality(&html);
    JsHardenResult {
        html: r.html,
        counts: JsHardenCounts {
            white_alpha_capped: r.counts.white_alpha_capped,
            black_alpha_capped: r.counts.black_alpha_capped,
            tailwind_white_normalized: r.counts.tailwind_white_normalized,
            tailwind_black_normalized: r.counts.tailwind_black_normalized,
        },
        warnings: r
            .warnings
            .into_iter()
            .map(|w| JsHardenWarning {
                kind: match w.kind {
                    publish::WarningKind::BannedPhrase => "banned_phrase".to_string(),
                    publish::WarningKind::GenericCta => "generic_cta".to_string(),
                    publish::WarningKind::CopiedSection => "copied_section".to_string(),
                },
                matched: w.matched,
            })
            .collect(),
    }
}
