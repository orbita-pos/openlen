use std::cell::{Cell, RefCell};
use std::collections::HashSet;

use lol_html::{element, rewrite_str, RewriteStrSettings};

use super::id::{base36, de_base36};
use super::OP_ID_ATTR;
use crate::error::EngineError;

/// Tags lol-html visits but the model never references — head metadata, raw
/// text containers (script/style), and pure-presentational singletons. Mirror
/// of the SKIP_TAGS set in lib/html-ops.ts; keep in lock-step so the tagged
/// output is byte-equivalent across engines during shadow soak.
const SKIP_TAGS: &[&str] = &[
    "html", "head", "meta", "title", "link", "script", "style", "noscript", "br", "hr",
];

#[derive(Debug, Clone)]
pub struct TaggedHtmlResult {
    pub tagged_html: String,
    pub tagged_count: u32,
}

/// Inject `data-op-id="<base36>"` on every addressable element. Counter is
/// monotonic across the document; an element that already carries an op-id
/// (from an upstream pipeline) keeps it. Empty/whitespace input passes
/// through unchanged with `tagged_count = 0`.
pub fn tag_with_op_ids(html: &str) -> Result<TaggedHtmlResult, EngineError> {
    if html.trim().is_empty() {
        return Ok(TaggedHtmlResult {
            tagged_html: html.to_string(),
            tagged_count: 0,
        });
    }

    // ─── POR DONDE CONTINUAR LA NUMERACION ──────────────────────────────
    //
    // El contador arrancaba SIEMPRE en 0 y este mismo handler se salta el
    // elemento que ya trae id. Con un documento a medio etiquetar —que es lo
    // que llega desde que `apply_ops` puede conservarlos— eso acunaba un id que
    // YA ESTABA PUESTO en otro elemento: dos elementos con el mismo id, y el
    // motor rechaza la tanda entera por «tagging invariant violated».
    //
    // 🔴 Y NO VALE «EL PRIMER HUECO LIBRE». Si el 3 se borra y luego se
    // reutiliza para un elemento nuevo, el modelo que todavia recuerda el 3
    // apunta a OTRA COSA — que es exactamente el incidente del <footer> que
    // obligaba a releer el documento tras cada edicion. Se acuna SIEMPRE por
    // encima del maximo: un id no se reutiliza jamas.
    let usados = ids_presentes(html)?;
    let inicio = usados
        .iter()
        .filter_map(|s| de_base36(s))
        .max()
        .map(|m| m + 1)
        .unwrap_or(0);
    let counter = Cell::new(inicio);

    let tagged = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("*", |el| {
                let tag = el.tag_name();
                if SKIP_TAGS.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
                    return Ok(());
                }
                if el.get_attribute(OP_ID_ATTR).is_some() {
                    return Ok(());
                }
                // El salto cubre los ids que NO son nuestros (un pipeline de
                // arriba pudo poner "sec-hero"): no entran en el maximo, asi
                // que hay que esquivarlos uno a uno.
                let mut id = base36(counter.get());
                while usados.contains(&id) {
                    counter.set(counter.get() + 1);
                    id = base36(counter.get());
                }
                counter.set(counter.get() + 1);
                el.set_attribute(OP_ID_ATTR, &id)
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| EngineError::Rewrite(e.to_string()))?;

    Ok(TaggedHtmlResult {
        tagged_html: tagged,
        // Cuantos se ESTAMPARON en esta pasada, no el valor del contador: con
        // ids preservados el contador arranca alto y contarlo diria que se
        // etiquetaron decenas de elementos que ya venian etiquetados.
        tagged_count: counter.get().saturating_sub(inicio),
    })
}

/// Los `data-op-id` que ya lleva el documento.
fn ids_presentes(html: &str) -> Result<HashSet<String>, EngineError> {
    let encontrados: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("[data-op-id]", |el| {
                if let Some(v) = el.get_attribute(OP_ID_ATTR) {
                    encontrados.borrow_mut().insert(v);
                }
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| EngineError::Rewrite(e.to_string()))?;
    Ok(encontrados.into_inner())
}
