// Element-level removals: dangerous embed containers (iframe, object, embed,
// applet, portal) and dangerous meta tags (http-equiv=refresh|set-cookie).
// Combines steps 2 and 5 of lib/style-match/autofill/sanitize.ts.
//
// Why these elements: iframe/object/embed/applet/portal can pull in remote
// markup we can't audit at sanitization time, including scripts that bypass
// CSP for the parent page in some browser configurations. <meta http-equiv=
// refresh> is a redirect attack (instant browser navigation to attacker-chosen
// URL); set-cookie via meta is non-standard but supported by some browsers as
// a session-fixation vector.

use lol_html::{element, rewrite_str, RewriteStrSettings};

use super::url::autoridad_y_ruta;

use crate::error::EngineError;
use crate::sanitize::RemovedCounts;

// `iframe` NO está aquí desde el 2026-08-31: pasa por la lista blanca de abajo.
// Los otros cuatro no tienen caso legítimo en una página de aterrizaje.
const DANGEROUS_ELEMENTS: &[&str] = &["object", "embed", "applet", "portal"];

/// Los ÚNICOS `<iframe>` que sobreviven: host EXACTO + prefijo de ruta.
///
/// POR QUÉ EXISTE ESTA LISTA. El 2026-08-26 salieron de la tubería los horneados
/// de vídeo y mapas, con el razonamiento de que ya no hacían falta: el JavaScript
/// del modelo dejó de estar prohibido, así que «que el modelo escriba el iframe».
/// Pero la mano del `<iframe>` seguía atada aquí — se soltó la del `<script>` y
/// no la de esto. Un mapa de Google en una página de un taller mecánico es el
/// caso canónico, y no había forma de ponerlo. Reportado por Jesús el 2026-08-30.
///
/// EL PREFIJO DE RUTA NO ES ADORNO: `www.google.com` sirve medio internet, así
/// que sin él la lista blanca abriría un iframe a cualquier cosa de Google
/// —Drive, cuentas, un doc—. Es la misma cautela que ya estaba escrita en
/// `lib/publish/map-embed.ts` y que este fichero hereda.
const IFRAMES_PERMITIDOS: &[(&str, &str)] = &[
    ("www.google.com", "/maps"),
    ("maps.google.com", ""),
    ("www.youtube.com", "/embed/"),
    ("youtube.com", "/embed/"),
    ("www.youtube-nocookie.com", "/embed/"),
    ("player.vimeo.com", "/video/"),
];

/// ¿Este `src` apunta a un embebido permitido? Host EXACTO + prefijo de ruta.
///
/// La lectura de la URL —y el porqué de cada una de sus reglas— vive desde el
/// 2026-08-31 en `super::url::autoridad_y_ruta`, que comparte con la puerta del
/// CDN de Tailwind (`scripts.rs`). Aquí se queda sólo la lista y la comparación.
fn iframe_permitido(src: &str) -> bool {
    let (autoridad, ruta) = match autoridad_y_ruta(src) {
        Some(par) => par,
        None => return false,
    };
    IFRAMES_PERMITIDOS
        .iter()
        .any(|(host, prefijo)| autoridad == *host && ruta.starts_with(prefijo))
}

fn is_dangerous_http_equiv(value: &str) -> bool {
    let v = value.trim().to_ascii_lowercase();
    v == "refresh" || v == "set-cookie"
}

pub fn strip_dangerous_elements(
    html: &str,
    removed: &mut RemovedCounts,
) -> Result<String, EngineError> {
    if html.is_empty() {
        return Ok(String::new());
    }
    let iframes = std::cell::Cell::new(0u32);
    let metas = std::cell::Cell::new(0u32);

    let selector = DANGEROUS_ELEMENTS.join(", ");

    let out = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!(selector, |el| {
                    el.remove();
                    iframes.set(iframes.get() + 1);
                    Ok(())
                }),
                element!("iframe", |el| {
                    // `srcdoc` es marcado EN LÍNEA que nadie saneó — se colaría
                    // entero, `<script>` incluido. Un iframe que lo trae se va,
                    // aunque su `src` estuviera en la lista.
                    let con_srcdoc = el.get_attribute("srcdoc").is_some();
                    let src = el.get_attribute("src").unwrap_or_default();
                    if con_srcdoc || !iframe_permitido(&src) {
                        el.remove();
                        iframes.set(iframes.get() + 1);
                    }
                    Ok(())
                }),
                element!("meta[http-equiv]", |el| {
                    let v = el.get_attribute("http-equiv").unwrap_or_default();
                    if is_dangerous_http_equiv(&v) {
                        el.remove();
                        metas.set(metas.get() + 1);
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| EngineError::Rewrite(e.to_string()))?;

    removed.iframes += iframes.get();
    removed.meta_refresh += metas.get();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un iframe cualquiera sigue cayendo. Protocolo-relativo: ni siquiera dice
    /// quien lo sirve.
    #[test]
    fn iframe_removed() {
        let mut r = RemovedCounts::default();
        let out =
            strip_dangerous_elements("<p>x</p><iframe src=\"//evil\"></iframe>", &mut r).unwrap();
        assert!(!out.contains("<iframe"));
        assert_eq!(r.iframes, 1);
    }

    /// LO QUE LA LISTA BLANCA DEJA PASAR. Sin esto no hay forma de poner un
    /// mapa en una pagina, que es el bug que abrio esta puerta.
    #[test]
    fn iframe_permitido_sobrevive() {
        for src in [
            "https://www.google.com/maps/embed?pb=!1m18",
            "https://www.google.com/maps?q=Calle+Ficticia+12&output=embed",
            "https://maps.google.com/?q=x&output=embed",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://player.vimeo.com/video/123456",
            // COINCIDIR CON EL NAVEGADOR, que es la regla entera: el borra
            // TAB/LF/CR de una URL antes de pedirla, asi que esto LE llega como
            // `www.google.com/maps`. Rechazarlo seria ser estricto contra un
            // ataque que no existe; el que si existe —colar un `@`— lo para su
            // propia regla, y esta arriba.
            "https://www.google\n.com/maps",
        ] {
            let mut r = RemovedCounts::default();
            let html = format!("<iframe src=\"{src}\"></iframe>");
            let out = strip_dangerous_elements(&html, &mut r).unwrap();
            assert!(out.contains("<iframe"), "deberia sobrevivir: {src}");
            assert_eq!(r.iframes, 0, "no deberia contarse como quitado: {src}");
        }
    }

    /// CADA UNO DE ESTOS ES UN ATAQUE CONOCIDO, y cada linea tapa el suyo.
    #[test]
    fn iframe_impostor_cae() {
        for (src, motivo) in [
            // El navegador va a evil.com; el ojo humano lee Google.
            ("https://www.google.com@evil.com/maps", "usuario en la autoridad"),
            // La barra invertida la normaliza el navegador a `/`.
            ("https://www.google.com\\@evil.com/maps", "barra invertida"),
            // Partir el `@` con un salto no lo esconde: se quita ANTES de mirar.
            ("https://www.google.com\n@evil.com/maps", "arroba partida"),
            // Sufijo: `google.com.evil.com` NO es google.com.
            ("https://www.google.com.evil.com/maps", "sufijo"),
            // El host bueno, pero en la RUTA de otro.
            ("https://evil.com/www.google.com/maps", "host en la ruta"),
            // Sin cifrar.
            ("http://www.google.com/maps", "http"),
            // Esquemas que no son de red.
            ("javascript:alert(1)", "javascript"),
            ("data:text/html,<script>alert(1)</script>", "data"),
            // Host permitido, RUTA que no: `www.google.com` sirve medio internet.
            ("https://www.google.com/accounts", "ruta fuera del prefijo"),
            ("https://www.youtube.com/watch?v=x", "youtube sin /embed/"),
            // Un puerto no aporta nada a un embebido.
            ("https://www.google.com:8080/maps", "puerto"),
            // Vacio.
            ("https://", "sin autoridad"),
        ] {
            let mut r = RemovedCounts::default();
            let html = format!("<iframe src=\"{src}\"></iframe>");
            let out = strip_dangerous_elements(&html, &mut r).unwrap();
            assert!(!out.contains("<iframe"), "deberia caer ({motivo}): {src}");
            assert_eq!(r.iframes, 1, "deberia contarse ({motivo}): {src}");
        }
    }

    /// `srcdoc` es marcado EN LINEA que nadie saneo. Cae aunque el `src` fuera
    /// bueno: si sobreviviera, ese marcado entraria entero.
    #[test]
    fn iframe_con_srcdoc_cae_aunque_el_src_sea_bueno() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements(
            "<iframe src=\"https://www.google.com/maps\" srcdoc=\"<script>alert(1)</script>\"></iframe>",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("<iframe"));
        assert!(!out.contains("alert"));
        assert_eq!(r.iframes, 1);
    }

    /// Un iframe SIN `src` no ensena nada y no tiene por que quedarse.
    #[test]
    fn iframe_sin_src_cae() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements("<iframe></iframe>", &mut r).unwrap();
        assert!(!out.contains("<iframe"));
        assert_eq!(r.iframes, 1);
    }

    /// El esquema y el host en MAYUSCULAS son el mismo host.
    #[test]
    fn iframe_permitido_ignora_mayusculas() {
        let mut r = RemovedCounts::default();
        let out =
            strip_dangerous_elements("<iframe src=\"HTTPS://WWW.GOOGLE.COM/maps\"></iframe>", &mut r)
                .unwrap();
        assert!(out.contains("<iframe"));
        assert_eq!(r.iframes, 0);
    }

    #[test]
    fn object_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements("<object data=\"//evil\"></object>", &mut r).unwrap();
        assert!(!out.contains("<object"));
        assert_eq!(r.iframes, 1);
    }

    #[test]
    fn embed_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements("<embed src=\"//evil\">", &mut r).unwrap();
        assert!(!out.contains("<embed"));
        assert_eq!(r.iframes, 1);
    }

    #[test]
    fn applet_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements("<applet code=\"bad.class\"></applet>", &mut r).unwrap();
        assert!(!out.contains("<applet"));
        assert_eq!(r.iframes, 1);
    }

    #[test]
    fn portal_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements("<portal src=\"//x\"></portal>", &mut r).unwrap();
        assert!(!out.contains("<portal"));
        assert_eq!(r.iframes, 1);
    }

    #[test]
    fn multiple_iframes_counted() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements(
            "<iframe></iframe><iframe></iframe><iframe></iframe>",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("<iframe"));
        assert_eq!(r.iframes, 3);
    }

    #[test]
    fn meta_refresh_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements(
            "<meta http-equiv=\"refresh\" content=\"0;url=//evil\">",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("http-equiv"));
        assert_eq!(r.meta_refresh, 1);
    }

    #[test]
    fn meta_refresh_mixed_case_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements("<meta http-equiv=\"REFRESH\" content=\"0\">", &mut r)
            .unwrap();
        assert!(!out.contains("REFRESH"));
        assert_eq!(r.meta_refresh, 1);
    }

    #[test]
    fn meta_set_cookie_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_dangerous_elements(
            "<meta http-equiv=\"set-cookie\" content=\"sid=abc\">",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("http-equiv"));
        assert_eq!(r.meta_refresh, 1);
    }

    #[test]
    fn meta_charset_kept() {
        let mut r = RemovedCounts::default();
        let html = "<meta charset=\"utf-8\">";
        assert_eq!(strip_dangerous_elements(html, &mut r).unwrap(), html);
    }

    #[test]
    fn meta_viewport_kept() {
        let mut r = RemovedCounts::default();
        let html = "<meta name=\"viewport\" content=\"width=device-width\">";
        assert_eq!(strip_dangerous_elements(html, &mut r).unwrap(), html);
    }

    #[test]
    fn meta_http_equiv_content_type_kept() {
        let mut r = RemovedCounts::default();
        // content-type is a legitimate http-equiv value, must NOT be removed.
        let html = "<meta http-equiv=\"content-type\" content=\"text/html; charset=utf-8\">";
        assert_eq!(strip_dangerous_elements(html, &mut r).unwrap(), html);
    }

    #[test]
    fn clean_html_byte_equal() {
        let mut r = RemovedCounts::default();
        let html = "<div><p>hello</p></div>";
        assert_eq!(strip_dangerous_elements(html, &mut r).unwrap(), html);
    }

    #[test]
    fn empty_input_passes_through() {
        let mut r = RemovedCounts::default();
        assert_eq!(strip_dangerous_elements("", &mut r).unwrap(), "");
    }
}
