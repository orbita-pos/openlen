use std::cell::Cell;

use kuchikiki::traits::TendrilSink;
use lol_html::html_content::ContentType;
use lol_html::{element, rewrite_str, RewriteStrSettings};

use super::OP_ID_ATTR;

/// Resolve a CSS-selector breadcrumb (from the iframe's section-select
/// script) against an already-tagged document, returning the matched
/// element's `data-op-id`. Used by the Chat AI route to turn a click
/// gesture into a hard pin for Kimi.
///
/// Returns `None` when the path is empty, the document doesn't parse, the
/// selector itself is invalid, or it doesn't match anything. The caller
/// falls back to the textual hint in that case — so a miss never breaks
/// the request.
pub fn resolve_op_id_by_path(tagged_html: &str, path: &str) -> Option<String> {
    if path.trim().is_empty() {
        return None;
    }
    if tagged_html.trim().is_empty() {
        return None;
    }
    let doc = kuchikiki::parse_html().one(tagged_html);
    // The client builds paths starting at the first descendant of <body>;
    // anchoring here makes the selector unambiguous in docs that repeat
    // structures (e.g. <main><section>… inside <body><main>).
    let full = if path.starts_with("body") {
        path.to_string()
    } else {
        format!("body > {}", path)
    };
    let mut matched = match doc.select(&full) {
        Ok(it) => it,
        Err(_) => return None,
    };
    let first = matched.next()?;
    let attrs = first.attributes.borrow();
    let id = attrs.get(OP_ID_ATTR)?;
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

/// El `outerHTML` EXACTO del elemento que lleva esta op-id, byte a byte.
///
/// 🔴 POR QUÉ NO SE SERIALIZA EL ÁRBOL. `kuchikiki` sabe encontrar el elemento
/// en dos líneas, pero al volver a escribirlo lo NORMALIZA: comillas, orden de
/// atributos, forma de las entidades. Y este recorte se vuelve a meter en el
/// documento (el taller lo usa para mover una sección), así que normalizarlo
/// sería reescribir la página del usuario para cambiarla de sitio.
///
/// Así que el parser sólo marca los BORDES: se pasa el documento por lol_html
/// —que conserva byte a byte todo lo que no toca un manejador— insertando dos
/// comentarios centinela justo antes y justo después del elemento. Lo que queda
/// entre ellos en la salida es el original sin tocar.
///
/// Sustituye a `elementoDe` en TypeScript, que buscaba la apertura con
/// `<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*\bdata-op-id="…"[^>]*>`. Ese `[^>]*` no
/// cruza un `>`, así que sobre un `<img alt="Antes > Despues" …>` devolvía
/// `None` — y el taller convertía eso en `ruta_no_resuelve`, tumbando la tanda
/// ENTERA. Medido el 2026-09-01.
///
/// `None` cuando la op-id no está, cuando aparece más de una vez, o cuando el
/// documento ya traía uno de los centinelas (documento adversario).
pub fn outer_html_by_op_id(tagged_html: &str, op_id: &str) -> Option<String> {
    const ABRE: &str = "<!--ol-cut-a-->";
    const CIERRA: &str = "<!--ol-cut-b-->";
    if tagged_html.contains(ABRE) || tagged_html.contains(CIERRA) {
        return None;
    }

    let vistos = Cell::new(0u32);
    let marcado = rewrite_str(
        tagged_html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("[data-op-id]", |el| {
                if el.get_attribute(OP_ID_ATTR).as_deref() == Some(op_id) {
                    vistos.set(vistos.get() + 1);
                    el.before(ABRE, ContentType::Html);
                    el.after(CIERRA, ContentType::Html);
                }
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .ok()?;
    if vistos.get() != 1 {
        return None;
    }

    let inicio = marcado.find(ABRE)? + ABRE.len();
    let fin = marcado[inicio..].find(CIERRA)? + inicio;
    Some(marcado[inicio..fin].to_string())
}
