pub mod accent;
pub mod color;
pub mod font;
pub mod modes;
pub mod radius;
pub mod space;
pub mod type_pass;

pub use accent::normalize_accent;
pub use color::normalize_color;
pub use font::normalize_font;
pub use modes::normalize_color_modes;
pub use radius::normalize_radius;
pub use space::normalize_space;
pub use type_pass::normalize_type;

/// Born-canonical normalizer — the 7-pass chain. Idempotent end-to-end:
/// re-running on already-canonical HTML is a no-op because each pass
/// short-circuits on its marker.
pub fn normalize_born_canonical(html: &str) -> String {
    let s = normalize_radius(html);
    let s = normalize_space(&s);
    let s = normalize_type(&s);
    let s = normalize_font(&s);
    let s = normalize_accent(&s);
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
    let mut injection = String::new();
    if html.contains("<style data-ol-radius") && !html.contains("<script data-ol-radius") {
        injection.push_str(radius::CONFIG_SCRIPT);
    }
    if html.contains("<style data-ol-space") && !html.contains("<script data-ol-space") {
        injection.push_str(&space::CONFIG_SCRIPT);
    }
    if html.contains("<style data-ol-type") && !html.contains("<script data-ol-type") {
        injection.push_str(&type_pass::CONFIG_SCRIPT);
    }
    if injection.is_empty() {
        return html.to_string();
    }
    match ENSURE_HEAD_CLOSE_RE.find(html) {
        Some(m) => {
            let mut out = String::with_capacity(html.len() + injection.len());
            out.push_str(&html[..m.start()]);
            out.push_str(&injection);
            out.push_str(&html[m.start()..]);
            out
        }
        None => {
            let mut out = String::with_capacity(html.len() + injection.len());
            out.push_str(html);
            out.push_str(&injection);
            out
        }
    }
}

static ENSURE_HEAD_CLOSE_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?i)</head>").unwrap());

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
        for tag in ["<script data-ol-radius>", "<script data-ol-space>", "<script data-ol-type>"] {
            let pos = healed.find(tag).unwrap();
            assert!(pos < head_close, "{tag} debe quedar dentro de <head>");
        }
    }
}
