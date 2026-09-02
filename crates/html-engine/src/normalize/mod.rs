pub mod color;
pub mod modes;
pub mod radius;
pub mod space;
pub mod type_pass;

pub use color::normalize_color;
pub use modes::normalize_color_modes;
pub use radius::normalize_radius;
pub use space::normalize_space;
pub use type_pass::normalize_type;

/// Repone el `<script>` de una pasada JUNTO A SU `<style>`, no al final.
///
/// 🔴 ÉSTA ERA LA RAÍZ DE QUE EL PIPELINE NO FUERA IDEMPOTENTE EN EL ORDEN.
///
/// Las tres pasadas que inyectan (radius, space, type) añadían su bloque antes
/// de `</head>` —o al final del documento si no hay `</head>`—. En la PRIMERA
/// vuelta faltan las dos cosas, así que el bloque sale `script` + `style`
/// pegados. En la SEGUNDA, el saneador ya se llevó el `<script>` —mata todo
/// script inline— pero el `<style>` sigue, así que la pasada reponía SÓLO el
/// script… y lo mandaba al final:
///
/// ```text
/// 1ª vuelta   …</div><script data-ol-radius>…</script><style data-ol-radius>…
/// 2ª vuelta   …</div><style data-ol-radius>…</style>…<script data-ol-radius>…
/// ```
///
/// Mismo contenido, mismos bytes en total, distinto orden. Inofensivo en la
/// página —los `<style>` definen tokens y los `<script>` configuran Tailwind, no
/// se leen entre sí— pero rompe toda comparación de bytes aguas abajo: un hash
/// que decida «esta página tiene cambios sin publicar» diría que sí sin que
/// nadie la tocara.
///
/// Reponiéndolo delante de su `<style>` la segunda vuelta reconstruye la
/// disposición de la primera, y el pipeline vuelve a ser idempotente byte a
/// byte. Y sigue quedando dentro del `<head>` sin buscarlo: el `<style>` ya
/// está ahí.
pub(crate) fn script_antes_de_su_style(
    html: &str,
    style_tag: &str,
    script: &str,
) -> Option<String> {
    html.find(style_tag).map(|pos| {
        let mut out = String::with_capacity(html.len() + script.len());
        out.push_str(&html[..pos]);
        out.push_str(script);
        out.push_str(&html[pos..]);
        out
    })
}

/// Born-canonical normalizer.
///
/// ERAN 7 PASADAS; quedan 5. `normalize_accent` y `normalize_font` salieron el
/// 2026-08-26 porque no inyectaban: REESCRIBÍAN. El acento decidía por su
/// cuenta cuál era el color de marca —por nombre o por croma ≥ 0.2— y sustituía
/// ese hex por un token en `<style>`, en `style=""`, en las clases `[#hex]` de
/// Tailwind y en la config; la fuente hacía lo mismo con la familia. El modelo
/// escribía un color y salía otro, sin rastro.
///
/// Las que quedan sólo AÑADEN vocabulario (radio, densidad, escala tipográfica,
/// roles de color, modos claro/oscuro): es lo que hace funcionar el inspector, y
/// una página que no lo use sale byte a byte igual. Idempotent end-to-end:
/// re-running on already-canonical HTML is a no-op because each pass
/// short-circuits on its marker.
pub fn normalize_born_canonical(html: &str) -> String {
    let s = normalize_radius(html);
    let s = normalize_space(&s);
    let s = normalize_type(&s);
    let s = normalize_color(&s);
    normalize_color_modes(&s)
}

/// Reparación post-sanitize (bug 2026-07-29): el sanitizer mata todo <script>
/// inline — incluidos los tres scripts de tema que mapean las utilities de
/// Tailwind a los tokens --ol-* — pero los <style data-ol-*> sobreviven.
/// Re-inyecta SOLO el script canónico que falte cuando su <style> hermano
/// está presente (bytes nuestros, constantes del crate). Nunca normaliza un
/// documento virgen: eso es trabajo de normalize_born_canonical en la
/// ingestión, y callers del sanitizer como el scrape de autofill no deben
/// ganar tokens por accidente.
pub fn ensure_theme_scripts(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    // 🔴 CADA SCRIPT VUELVE JUNTO A SU `<style>`, no todos juntos al final.
    //
    // Antes se concatenaban los tres en un bloque y se metía entero antes de
    // `</head>` (o al final del documento si no había `</head>`). Eso rompía la
    // IDEMPOTENCIA DE ORDEN del pipeline de streaming, y así se veía:
    //
    //   1ª vuelta  <script radius><style radius><script space><style space>…
    //   2ª vuelta  <style radius><style space><style type><script radius>…
    //
    // porque en la segunda el saneador se lleva los `<script>` —mata todo script
    // inline— y esta función los reponía agrupados detrás. El contenido salía
    // idéntico y los bytes no, que es lo que rompe cualquier comparación de
    // hash aguas abajo (p. ej. decidir si una página tiene cambios sin publicar).
    //
    // Reponiéndolos delante de su `<style>` hermano se reconstruye exactamente
    // la disposición que produce `normalize_born_canonical`, así que la segunda
    // vuelta sale byte a byte igual que la primera. Y sigue quedando DENTRO del
    // `<head>` sin buscarlo: el `<style>` ya está ahí.
    let mut out = html.to_string();
    let radius_script: &str = radius::CONFIG_SCRIPT;
    let space_script: &str = &space::CONFIG_SCRIPT;
    let type_script: &str = &type_pass::CONFIG_SCRIPT;
    for (marca_style, marca_script, script) in [
        (
            "<style data-ol-radius",
            "<script data-ol-radius",
            radius_script,
        ),
        (
            "<style data-ol-space",
            "<script data-ol-space",
            space_script,
        ),
        ("<style data-ol-type", "<script data-ol-type", type_script),
    ] {
        if out.contains(marca_script) {
            continue;
        }
        if let Some(pos) = out.find(marca_style) {
            out.insert_str(pos, script);
        }
    }
    out
}
#[cfg(test)]
mod ensure_tests {
    use super::*;
    use crate::sanitize::sanitize_for_publish;

    const DOC: &str = "<html><head><script src=\"https://cdn.tailwindcss.com\"></script><style>.card{border-radius:12px}</style></head><body><div class=\"rounded-lg p-4 text-xl\">x</div></body></html>";

    #[test]
    fn noop_on_virgin_html() {
        // Sin marcadores → byte-igual. Jamás normaliza por primera vez.
        assert_eq!(ensure_theme_scripts(DOC), DOC);
        assert_eq!(ensure_theme_scripts(""), "");
    }

    #[test]
    fn repairs_all_three_after_sanitize() {
        let normalized = normalize_born_canonical(DOC);
        // El sanitizer real es quien mata los scripts (integración fiel).
        let sanitized = sanitize_for_publish(&normalized).html.unwrap();
        assert!(!sanitized.contains("<script data-ol-radius"));
        assert!(!sanitized.contains("<script data-ol-space"));
        assert!(!sanitized.contains("<script data-ol-type"));
        let healed = ensure_theme_scripts(&sanitized);
        assert!(healed.contains("<script data-ol-radius>"));
        assert!(healed.contains("<script data-ol-space>"));
        assert!(healed.contains("<script data-ol-type>"));
        // sin duplicar styles
        assert_eq!(healed.matches("<style data-ol-radius").count(), 1);
        assert_eq!(healed.matches("<style data-ol-space").count(), 1);
        assert_eq!(healed.matches("<style data-ol-type").count(), 1);
    }

    #[test]
    fn noop_when_scripts_already_present() {
        let normalized = normalize_born_canonical(DOC);
        assert_eq!(ensure_theme_scripts(&normalized), normalized);
    }

    #[test]
    fn ensure_is_idempotent() {
        let normalized = normalize_born_canonical(DOC);
        let sanitized = sanitize_for_publish(&normalized).html.unwrap();
        let healed = ensure_theme_scripts(&sanitized);
        assert_eq!(ensure_theme_scripts(&healed), healed);
    }

    #[test]
    fn scripts_land_inside_head() {
        let normalized = normalize_born_canonical(DOC);
        let sanitized = sanitize_for_publish(&normalized).html.unwrap();
        let healed = ensure_theme_scripts(&sanitized);
        let head_close = healed.find("</head>").unwrap();
        for tag in [
            "<script data-ol-radius>",
            "<script data-ol-space>",
            "<script data-ol-type>",
        ] {
            let pos = healed.find(tag).unwrap();
            assert!(pos < head_close, "{tag} debe quedar dentro de <head>");
        }
    }
}
