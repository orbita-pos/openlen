// Release seal — the terminal publish pass.
//
// LA CSP SE RETIRÓ el 2026-08-26, por decisión de Jesús. Este pase emitía una
// política que fijaba `script-src` por HASH, `connect-src 'self'`, `img-src`
// acotada y `form-action 'self'`: convertía el conjunto CERRADO de scripts que
// dejaba el saneador en una regla que el navegador hacía cumplir.
//
// Ese conjunto ya no es cerrado. Desde que el código del modelo ES el código de
// la página, `script-src` por hash significaba re-sellar en cada edición — la
// misma fragilidad que la cápsula, y por el mismo motivo. Y `connect-src 'self'`
// impedía cargar una librería de un CDN o hablar con una API, que es justo lo
// que hace falta para una detección de caras, un mapa o un SDK de pagos.
//
// LO QUE ACOTA EL DAÑO AHORA es el dominio, no la jaula: las páginas viven en
// `openlen.app`, separado de la app. Meterlo en la Public Suffix List es lo que
// hace que un sitio turbio se queme solo en vez de arrastrar al comodín — está
// pendiente y anotado.
//
// LO QUE ESTE PASE SIGUE HACIENDO, y no es CSP: dos endurecimientos del marcado
// en la misma pasada — quita los `<base>` (secuestran TODA URL relativa de la
// página, y casi siempre son un error de copiar y pegar) y pone `rel=noopener`
// en cada `target=_blank` (sin él la pestaña que abres puede reescribir la
// tuya). Ninguno de los dos decide nada de diseño.
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use kuchikiki::traits::TendrilSink;
use kuchikiki::{NodeData, NodeRef};
use sha2::{Digest, Sha256};

use super::serialize_doc;

#[derive(Debug)]
pub struct SealResult {
    pub html: String,
    /// True when the CSP meta is present in the output.
    pub sealed: bool,
    /// `'sha256-…'` source tokens, one per unique inline script.
    pub script_hashes: Vec<String>,
    /// Origins of external <script src> elements (the Tailwind CDN, when
    /// the bake fell back).
    pub external_scripts: Vec<String>,
    pub bases_stripped: u32,
    pub noopener_added: u32,
    pub errors: Vec<String>,
}

pub fn seal_release(
    html: &str,
    // Alimentaban `form-action` y `connect-src` de la política. La firma se
    // conserva porque la comparte el binding napi y sus llamadores; el día que
    // se limpie, se limpia entera.
    _form_action_extra: Option<&str>,
    _connect_src_extra: Option<&str>,
) -> SealResult {
    let doc = kuchikiki::parse_html().one(html);
    let mut errors: Vec<String> = Vec::new();

    // Idempotency: drop any seal from a prior run before re-measuring.
    detach_all(&doc, "meta[data-ol-csp]");

    let bases_stripped = detach_all(&doc, "base");
    let noopener_added = add_noopener(&doc);
    let (script_hashes, external_scripts, unparseable) = collect_scripts(&doc);

    let author_csp = doc
        .select("meta")
        .map(|it| {
            it.filter(|m| {
                m.attributes
                    .borrow()
                    .get("http-equiv")
                    .map(|v| v.eq_ignore_ascii_case("content-security-policy"))
                    .unwrap_or(false)
            })
            .count()
                > 0
        })
        .unwrap_or(false);

    // `author_csp` se sigue detectando: si el MODELO escribió su propia política,
    // es suya y se respeta — no se toca ni se le añade nada. Es la misma regla
    // que antes, sólo que ahora nunca hay una segunda que pudiera intersecarla.
    if author_csp {
        errors.push("author CSP meta present; left as authored".to_string());
    }
    if let Some(src) = unparseable {
        errors.push(format!("script src without a parseable origin: {src}"));
    }
    // `sealed` deja de significar «lleva política» y pasa a significar «el pase
    // corrió». Se conserva el campo porque el llamador lo usa para contar
    // documentos, no para decidir nada.
    let sealed = true;

    let out = serialize_doc(&doc);

    // LA AUTO-COMPROBACIÓN SE VA CON LA POLÍTICA. Re-parseaba la salida y
    // verificaba que los hashes emitidos siguieran cuadrando con los scripts
    // ya serializados: cualquier deriva —un capricho del serializador, un
    // pase futuro ordenado después de éste— habría publicado una página que
    // bloquea sus propios scripts. Sin hashes que emitir no hay deriva
    // posible.

    SealResult {
        html: out,
        sealed,
        script_hashes,
        external_scripts,
        bases_stripped,
        noopener_added,
        errors,
    }
}

fn detach_all(doc: &NodeRef, selector: &str) -> u32 {
    let nodes: Vec<NodeRef> = match doc.select(selector) {
        Ok(it) => it.map(|n| n.as_node().clone()).collect(),
        Err(_) => return 0,
    };
    let n = nodes.len() as u32;
    for node in nodes {
        node.detach();
    }
    n
}

fn add_noopener(doc: &NodeRef) -> u32 {
    let anchors: Vec<NodeRef> = match doc.select("a[target]") {
        Ok(it) => it.map(|n| n.as_node().clone()).collect(),
        Err(_) => return 0,
    };
    let mut added = 0u32;
    for a in anchors {
        let NodeData::Element(d) = a.data() else {
            continue;
        };
        let mut attrs = d.attributes.borrow_mut();
        let is_blank = attrs
            .get("target")
            .map(|t| t.eq_ignore_ascii_case("_blank"))
            .unwrap_or(false);
        if !is_blank {
            continue;
        }
        let rel = attrs.get("rel").unwrap_or("").to_string();
        let has = rel
            .split_whitespace()
            .any(|t| t.eq_ignore_ascii_case("noopener"));
        if !has {
            let new_rel = if rel.trim().is_empty() {
                "noopener".to_string()
            } else {
                format!("{} noopener", rel.trim())
            };
            attrs.insert("rel", new_rel);
            added += 1;
        }
    }
    added
}

/// Returns (unique inline-script hash tokens in document order, unique
/// external script origins, first unparseable src if any).
fn collect_scripts(doc: &NodeRef) -> (Vec<String>, Vec<String>, Option<String>) {
    let mut hashes: Vec<String> = Vec::new();
    let mut externals: Vec<String> = Vec::new();
    let mut unparseable: Option<String> = None;

    let scripts: Vec<NodeRef> = match doc.select("script") {
        Ok(it) => it.map(|n| n.as_node().clone()).collect(),
        Err(_) => return (hashes, externals, None),
    };
    for s in scripts {
        let src = {
            let NodeData::Element(d) = s.data() else {
                continue;
            };
            let attrs = d.attributes.borrow();
            attrs.get("src").map(str::to_string)
        };
        match src {
            Some(src) if !src.trim().is_empty() => match script_origin(src.trim()) {
                Some(origin) => {
                    if !externals.contains(&origin) {
                        externals.push(origin);
                    }
                }
                None => {
                    if unparseable.is_none() {
                        unparseable = Some(src);
                    }
                }
            },
            _ => {
                // Inline (or empty-src) script: hash the exact text content —
                // the same bytes the browser hashes when enforcing.
                let text = s.text_contents();
                let digest = Sha256::digest(text.as_bytes());
                let token = format!("'sha256-{}'", BASE64.encode(digest));
                if !hashes.contains(&token) {
                    hashes.push(token);
                }
            }
        }
    }
    (hashes, externals, unparseable)
}

/// `https://host[:port]` from an absolute script src; None for anything
/// else (relative, protocol-relative, data:) — those make the seal bail.
fn script_origin(src: &str) -> Option<String> {
    let (scheme, rest) = if let Some(r) = src.strip_prefix("https://") {
        ("https://", r)
    } else {
        let r = src.strip_prefix("http://")?;
        ("http://", r)
    };
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..host_end];
    if host.is_empty() {
        return None;
    }
    Some(format!("{}{}", scheme, host.to_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    // 18 PRUEBAS RETIRADAS el 2026-08-26 con la política: hashes en `script-src`,
    // `connect-src 'self'`, `img-src` cerrada, `worker-src 'none'`, `frame-src`
    // fijada a los orígenes de vídeo, la colocación del `<meta>` tras el charset,
    // el ida y vuelta del escapado y la idempotencia del re-sellado. Todas eran
    // correctas y todas medían algo que ya no se emite.
    //
    // Lo que queda mide lo que este pase SIGUE haciendo: quitar los `<base>` y
    // poner `rel=noopener`. Ninguno de los dos es CSP.
    use super::*;

    fn hash_token(text: &str) -> String {
        format!(
            "'sha256-{}'",
            BASE64.encode(Sha256::digest(text.as_bytes()))
        )
    }

    #[test]
    fn raw_text_script_with_operators_hashes_exact_bytes() {
        let body = "if(a<b&&c>0){fetch('/c/x',{keepalive:true})}";
        let html = format!(r#"<body><script>{}</script></body>"#, body);
        let r = seal_release(&html, None, None);
        assert!(r.sealed);
        assert_eq!(r.script_hashes, vec![hash_token(body)]);
        // Serialization must not have altered the script body (self-check
        // would have caught it, but assert directly too).
        assert!(r.html.contains(body));
    }

    #[test]
    fn duplicate_inline_scripts_hash_once() {
        let html = r#"<body><script>same()</script><script>same()</script></body>"#;
        let r = seal_release(html, None, None);
        assert_eq!(r.script_hashes.len(), 1);
    }

    #[test]
    fn base_tags_stripped() {
        let html = r#"<html><head><base href="https://evil.example/"></head><body></body></html>"#;
        let r = seal_release(html, None, None);
        assert_eq!(r.bases_stripped, 1);
        assert!(!r.html.contains("<base"));
    }

    #[test]
    fn target_blank_gains_noopener_preserving_rel_tokens() {
        let html = r#"<body><a href="https://x.com" target="_blank" rel="nofollow">x</a><a href="/in" target="_self">y</a></body>"#;
        let r = seal_release(html, None, None);
        assert_eq!(r.noopener_added, 1);
        assert!(r.html.contains(r#"rel="nofollow noopener""#));
    }

    #[test]
    fn existing_noopener_not_duplicated() {
        let html = r#"<body><a href="https://x.com" target="_blank" rel="noopener">x</a></body>"#;
        let r = seal_release(html, None, None);
        assert_eq!(r.noopener_added, 0);
        assert_eq!(r.html.matches("noopener").count(), 1);
    }
}
