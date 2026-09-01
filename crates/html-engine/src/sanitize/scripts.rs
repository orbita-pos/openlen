// Strip `<script>` tags unless `src` matches a whitelisted CDN. Port of the
// first step in lib/style-match/autofill/sanitize.ts. Inline scripts and
// arbitrary remote scripts both get removed — the only thing we allow is the
// Tailwind CDN script because every template relies on it and we control the
// URL.

use lol_html::{element, rewrite_str, RewriteStrSettings};

use crate::error::EngineError;
use crate::sanitize::url::autoridad_y_ruta;
use crate::sanitize::RemovedCounts;

/// Los ÚNICOS `<script src>` que sobreviven: host EXACTO + prefijo de ruta.
///
/// El prefijo del CDN de Tailwind va vacío a propósito, y es la diferencia con
/// la lista de iframes de `elements.rs`: allí `www.google.com` sirve medio
/// internet y hace falta `/maps` para no abrir Drive; aquí el host ENTERO es el
/// CDN, así que cualquier ruta suya es el mismo recurso.
///
/// `libs.openlen.com` SÍ pide `/`, que es sólo exigir que haya una ruta: es
/// nuestro, sirve ficheros de librería congelados y nada más, y un `<script>`
/// apuntando al host pelado no es nada que queramos servir.
///
/// POR QUÉ NO SE FIJA AQUÍ LA VERSIÓN. Sería tentador poner
/// `/chart.js/4.5.0/` y clavarla en el binario. No: cada versión nueva pediría
/// tocar Rust, reconstruir el `.node` y desplegar. La versión se fija donde ya
/// se fija sola — en la RUTA que el prompt le da al modelo y en lo que de
/// verdad hemos subido. Una versión que no hayamos subido devuelve 404, y ése
/// es el control real, sin binario de por medio.
///
/// 🔴 LO QUE ESTA LISTA NO PUEDE HACER SOLA. Abrir el host aquí deja pasar la
/// etiqueta al publicar, pero NO le da al modelo forma de AÑADIRLA a una página
/// que no nació con ella: ese camino es `nodoDeCabezaPermitido`
/// (`lib/ai-stream/document-ops.ts`), que es una lista aparte. Y no sirve de
/// nada si el prompt no le cuenta que existen. Son TRES listas, y las tres
/// tienen que decir lo mismo — `lib/ai/librerias-acuerdo.test.ts` lo vigila.
const SCRIPTS_PERMITIDOS: &[(&str, &str)] = &[
    ("cdn.tailwindcss.com", ""),
    ("libs.openlen.com", "/"),
];

/// ¿Este `src` es el CDN de Tailwind?
///
/// POR QUÉ DEJÓ DE SER UNA COMPARACIÓN EXACTA. Hasta el 2026-08-31 esto era
/// `ALLOWED_SCRIPT_SRCS.contains(&trimmed)` contra DOS cadenas literales:
/// `https://cdn.tailwindcss.com` y esa misma con
/// `?plugins=forms,typography,aspect-ratio,line-clamp`. Cualquier otra forma
/// del MISMO CDN —`…com/3.4.16`, `…com/`, `?plugins=forms` a secas— se borraba
/// en silencio, mientras las dos expresiones regulares que buscan esa misma
/// etiqueta la comparan por PREFIJO (`lib/publish/tw-config.ts`,
/// `lib/publish/optimize-html.ts`). Tres sitios decidiendo «¿es esto el CDN de
/// Tailwind?» y dando tres respuestas distintas.
///
/// LA INVARIANTE QUE IMPORTA no es que los tres digan lo mismo — preguntan
/// cosas distintas. Esto es una PUERTA (¿puede sobrevivir?); las otras dos
/// BUSCAN la etiqueta para meterle el carrier detrás o para sustituirla por el
/// CSS horneado. Es ésta, y va en UNA sola dirección:
///
///   **lo que esta puerta DEJA PASAR, las dos expresiones tienen que
///   ENCONTRARLO.**
///
/// Si la puerta conserva una etiqueta que el horneado no sabe ver, `bakeTailwind`
/// se va por su rama «no hay CDN» y retira el carrier `data-ol-tw` por inerte
/// — pero el CDN sigue vivo en la página. El `theme.extend` desaparece y
/// `bg-ink` / `text-lime` compilan a NADA: es el bug blanco-sobre-blanco de
/// 2026-07-18, esta vez publicado. La invariante está clavada en
/// `lib/publish/tw-cdn-acuerdo.test.ts` contra el sanitizador REAL.
fn script_permitido(src: &str) -> bool {
    let (autoridad, ruta) = match autoridad_y_ruta(src) {
        Some(par) => par,
        None => return false,
    };
    SCRIPTS_PERMITIDOS
        .iter()
        .any(|(host, prefijo)| autoridad == *host && ruta.starts_with(prefijo))
}

/// Returns the rewritten HTML plus the count of `<script>` tags removed.
pub fn strip_scripts(html: &str, removed: &mut RemovedCounts) -> Result<String, EngineError> {
    if html.is_empty() {
        return Ok(String::new());
    }
    let counter = std::cell::Cell::new(0u32);
    let out = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("script", |el| {
                let src = el.get_attribute("src").unwrap_or_default();
                if script_permitido(&src) {
                    return Ok(());
                }
                el.remove();
                counter.set(counter.get() + 1);
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| EngineError::Rewrite(e.to_string()))?;
    removed.scripts += counter.get();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_passes_through() {
        let mut r = RemovedCounts::default();
        assert_eq!(strip_scripts("", &mut r).unwrap(), "");
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn inline_script_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_scripts("<p>x</p><script>alert(1)</script>", &mut r).unwrap();
        assert!(!out.contains("alert"));
        assert!(!out.contains("<script"));
        assert_eq!(r.scripts, 1);
    }

    #[test]
    fn whitelisted_tailwind_kept() {
        let mut r = RemovedCounts::default();
        let html = "<script src=\"https://cdn.tailwindcss.com\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("cdn.tailwindcss.com"));
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn whitelisted_tailwind_with_plugins_kept() {
        let mut r = RemovedCounts::default();
        let html = "<script src=\"https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,line-clamp\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("plugins=forms"));
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn non_whitelisted_src_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_scripts(
            "<script src=\"https://evil.example/x.js\"></script>",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("evil.example"));
        assert_eq!(r.scripts, 1);
    }

    #[test]
    fn empty_src_treated_as_inline() {
        // <script src=""> is inline-equivalent — strip it.
        let mut r = RemovedCounts::default();
        let out = strip_scripts("<script src=\"\">bad()</script>", &mut r).unwrap();
        assert!(!out.contains("<script"));
        assert_eq!(r.scripts, 1);
    }

    #[test]
    fn multiple_scripts_counted() {
        let mut r = RemovedCounts::default();
        let html = "<script>a()</script><p>x</p><script>b()</script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(!out.contains("<script"));
        assert_eq!(r.scripts, 2);
    }

    #[test]
    fn clean_html_byte_equal() {
        // No scripts to strip ⇒ output is identical to input.
        let mut r = RemovedCounts::default();
        let html = "<div class=\"foo\"><p>hello</p></div>";
        assert_eq!(strip_scripts(html, &mut r).unwrap(), html);
        assert_eq!(r.scripts, 0);
    }

    // --- Las formas del MISMO CDN que la igualdad exacta borraba en silencio.
    // Cada una de éstas la encuentran por prefijo las dos expresiones de
    // lib/publish/{tw-config,optimize-html}.ts, así que la puerta las tenía que
    // dejar pasar o la página se publicaba con el CDN vivo y sin carrier.

    #[test]
    fn tailwind_con_version_en_la_ruta_se_conserva() {
        let mut r = RemovedCounts::default();
        let html = "<script src=\"https://cdn.tailwindcss.com/3.4.16\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("3.4.16"));
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn tailwind_con_barra_final_se_conserva() {
        let mut r = RemovedCounts::default();
        let html = "<script src=\"https://cdn.tailwindcss.com/\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("cdn.tailwindcss.com"));
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn tailwind_con_un_solo_plugin_se_conserva() {
        // La lista vieja tenía los CUATRO plugins en una cadena literal; pedir
        // sólo `forms` era otra cadena, y se borraba.
        let mut r = RemovedCounts::default();
        let html = "<script src=\"https://cdn.tailwindcss.com?plugins=forms\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("plugins=forms"));
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn el_host_en_mayusculas_es_el_mismo_host() {
        let mut r = RemovedCounts::default();
        let html = "<script src=\"HTTPS://CDN.TAILWINDCSS.COM\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("CDN.TAILWINDCSS.COM"), "y se conserva tal cual");
        assert_eq!(r.scripts, 0, "la caja no puede cambiar el veredicto");
    }

    // --- Y lo que la forma nueva NO puede abrir de paso.

    #[test]
    fn abrir_la_ruta_no_abre_el_host() {
        let mut r = RemovedCounts::default();
        for src in [
            // Sufijo: el host bueno pegado a otro dominio.
            "https://cdn.tailwindcss.com.evil.example/x.js",
            // El host bueno como USUARIO de la autoridad de otro.
            "https://cdn.tailwindcss.com@evil.example/x.js",
            // El host bueno en la RUTA de otro.
            "https://evil.example/cdn.tailwindcss.com/x.js",
            // Sin TLS: no dice quién lo sirve.
            "http://cdn.tailwindcss.com",
            // Protocolo-relativo: hereda el esquema, tampoco lo dice.
            "//cdn.tailwindcss.com",
            // Un subdominio distinto NO es el CDN.
            "https://play.tailwindcss.com",
            "https://evil.cdn.tailwindcss.com/x.js",
        ] {
            let antes = r.scripts;
            let html = format!("<script src=\"{src}\"></script>");
            let out = strip_scripts(&html, &mut r).unwrap();
            assert!(!out.contains("<script"), "debía caer: {src}");
            assert_eq!(r.scripts, antes + 1, "debía contarse: {src}");
        }
    }

    // --- libs.openlen.com: las librerias congeladas.

    #[test]
    fn una_libreria_nuestra_sobrevive() {
        let mut r = RemovedCounts::default();
        let html = "<script src=\"https://libs.openlen.com/chart.js/4.5.0/chart.umd.min.js\"></script>";
        let out = strip_scripts(html, &mut r).unwrap();
        assert!(out.contains("chart.umd.min.js"));
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn cualquier_version_bajo_el_host_pasa() {
        // La version NO se fija aqui a proposito: se fija en lo que subimos.
        let mut r = RemovedCounts::default();
        for src in [
            "https://libs.openlen.com/swiper/12.2.0/swiper-bundle.min.js",
            "https://libs.openlen.com/chart.js/5.0.0/chart.umd.min.js",
        ] {
            let html = format!("<script src=\"{src}\"></script>");
            let out = strip_scripts(&html, &mut r).unwrap();
            assert!(out.contains("<script"), "debia sobrevivir: {src}");
        }
        assert_eq!(r.scripts, 0);
    }

    #[test]
    fn el_host_pelado_no_es_una_libreria() {
        // Sin ruta no hay fichero que servir; el prefijo "/" lo exige.
        let mut r = RemovedCounts::default();
        for src in [
            "https://libs.openlen.com",
            "https://libs.openlen.com?x=1",
        ] {
            let antes = r.scripts;
            let html = format!("<script src=\"{src}\"></script>");
            let out = strip_scripts(&html, &mut r).unwrap();
            assert!(!out.contains("<script"), "debia caer: {src}");
            assert_eq!(r.scripts, antes + 1);
        }
    }

    #[test]
    fn abrir_libs_no_abre_los_vecinos() {
        let mut r = RemovedCounts::default();
        for src in [
            "https://libs.openlen.com.evil.example/x.js",
            "https://evil.example/libs.openlen.com/x.js",
            "https://libs.openlen.app/x.js",
            "http://libs.openlen.com/x.js",
            // uploads/templates son NUESTROS pero los llena el USUARIO.
            "https://uploads.openlen.com/x.js",
            "https://templates.openlen.com/x.js",
        ] {
            let antes = r.scripts;
            let html = format!("<script src=\"{src}\"></script>");
            let out = strip_scripts(&html, &mut r).unwrap();
            assert!(!out.contains("<script"), "debia caer: {src}");
            assert_eq!(r.scripts, antes + 1, "debia contarse: {src}");
        }
    }
}
