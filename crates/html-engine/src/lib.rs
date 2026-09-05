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

/// Reparación post-sanitize: re-inyecta los scripts de tema (data-ol-radius/
/// space/type) que el sanitizer mató cuando su <style> hermano sobrevive.
/// No-op en documentos sin marcadores. Ver normalize::ensure_theme_scripts.
#[napi]
pub fn ensure_theme_scripts(html: String) -> String {
    normalize::ensure_theme_scripts(&html)
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

#[napi(object, js_name = "OpAttr")]
pub struct JsOpAttr {
    pub name: String,
    /// Ausente (`null`/`undefined`) QUITA el atributo. La cadena vacía lo
    /// escribe: `data-ol-reink=""` es como la re-tinta anota «este elemento no
    /// tenía color propio».
    pub value: Option<String>,
}

#[napi(object, js_name = "Op")]
pub struct JsOp {
    #[napi(js_name = "type")]
    pub op_type: String,
    pub target: String,
    pub new_html: Option<String>,
    /// Sólo para `type: "attrs"`.
    pub attrs: Option<Vec<JsOpAttr>>,
    /// Sólo para `type: "text"`: el texto nuevo del nodo.
    pub text: Option<String>,
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
                attrs: None,
                text: None,
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
/// `keep_op_ids`: CONSERVAR los `data-op-id` de lo que no se toco (por defecto,
/// se quitan). Solo para la copia de trabajo de una sesion — lo que se persiste
/// pasa por `persistHtmlChange`, que los limpia en el embudo.
pub fn apply_ops(tagged_html: String, ops: Vec<JsOp>, keep_op_ids: Option<bool>) -> JsApplyResult {
    let mut native_ops: Vec<apply::Op> = Vec::with_capacity(ops.len());
    let mut errors: Vec<JsApplyError> = Vec::new();
    for (i, o) in ops.iter().enumerate() {
        match apply::OpType::parse(&o.op_type) {
            Some(t) => native_ops.push(apply::Op {
                op_type: t,
                target: o.target.clone(),
                new_html: o.new_html.clone(),
                text: o.text.clone(),
                attrs: o
                    .attrs
                    .as_ref()
                    .map(|v| {
                        v.iter()
                            .map(|a| apply::Attr {
                                name: a.name.clone(),
                                value: a.value.clone(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
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
    let r = apply::apply_ops_ext(&tagged_html, &native_ops, keep_op_ids.unwrap_or(false));
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

#[napi(object, js_name = "RejectResult")]
pub struct JsRejectResult {
    pub ops: Vec<JsOp>,
    pub rejected: Vec<JsOp>,
}

/// Reparte una tanda entre lo aplicable y lo que se llevaría la página entera
/// (`replace`/`delete` contra `<html>` o `<body>`).
///
/// Vive en el crate porque la pregunta —«¿este op-id es la raíz?»— es sobre la
/// estructura del documento, y en TypeScript se contestaba con una expresión
/// regular que no puede cruzar un `>` dentro de un valor de atributo.
///
/// Una op con un tipo desconocido NO se rechaza aquí: se deja pasar para que
/// `apply_ops` la nombre con su propio error. Éste sólo decide sobre la raíz.
#[napi]
pub fn reject_document_wide_ops(tagged_html: String, ops: Vec<JsOp>) -> JsRejectResult {
    let targets: Vec<&str> = ops.iter().map(|o| o.target.as_str()).collect();
    let r = apply::reject_document_wide_ops(&tagged_html, &targets);
    let kept: std::collections::HashSet<usize> = r.kept.into_iter().collect();

    // Las ops salen TAL COMO ENTRARON. Un tipo desconocido tiene que llegar
    // intacto a `apply_ops`, que es quien sabe decir «Unknown op type».
    let mut js_kept = Vec::new();
    let mut js_rejected = Vec::new();
    for (i, o) in ops.into_iter().enumerate() {
        let js = JsOp {
            op_type: o.op_type,
            target: o.target,
            new_html: o.new_html,
            attrs: o.attrs,
            text: o.text,
        };
        if kept.contains(&i) {
            js_kept.push(js);
        } else {
            js_rejected.push(js);
        }
    }
    JsRejectResult {
        ops: js_kept,
        rejected: js_rejected,
    }
}

#[napi]
pub fn resolve_op_id_by_path(tagged_html: String, path: String) -> Option<String> {
    resolver::resolve_op_id_by_path(&tagged_html, &path)
}

/// El `outerHTML` exacto (byte a byte) del elemento con esta op-id.
#[napi]
pub fn outer_html_by_op_id(tagged_html: String, op_id: String) -> Option<String> {
    resolver::outer_html_by_op_id(&tagged_html, &op_id)
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
pub fn seal_release(
    html: String,
    form_action_extra: Option<String>,
    connect_src_extra: Option<String>,
) -> JsSealResult {
    let r = publish::seal_release(
        &html,
        form_action_extra.as_deref(),
        connect_src_extra.as_deref(),
    );
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

// ⚰️ Aquí cruzaba `HardenCounts` — cuatro `u32` que la impl devolvía siempre en
// cero desde que se retiraron las etapas que reescribían (2026-08-26). Borrado
// el 2026-09-05 del lado Rust y de este objeto: `index.d.ts` se regenera sin él.

#[napi(object, js_name = "HardenWarning")]
pub struct JsHardenWarning {
    /// "banned_phrase" | "generic_cta" | "copied_section"
    pub kind: String,
    pub matched: String,
}

#[napi(object, js_name = "HardenResult")]
pub struct JsHardenResult {
    pub html: String,
    pub warnings: Vec<JsHardenWarning>,
}

#[napi]
pub fn harden_visual_quality(html: String) -> JsHardenResult {
    let r = publish::harden_visual_quality(&html);
    JsHardenResult {
        html: r.html,
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
