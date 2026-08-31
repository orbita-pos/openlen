// La lectura de una URL de lista blanca, compartida por las dos puertas que la
// necesitan: los `<iframe>` (elements.rs) y el CDN de Tailwind (scripts.rs).
//
// POR QUÉ VIVE APARTE. Hasta el 2026-08-31 esto era el cuerpo de
// `iframe_permitido` y sólo lo tenía él, porque sólo él comparaba hosts: el
// `<script>` se decidía con una igualdad exacta contra dos cadenas literales.
// Al darle a los scripts la misma forma —host exacto + prefijo de ruta— la
// alternativa era copiar veinte líneas de análisis de URL con implicaciones de
// seguridad en un segundo fichero. Un análisis duplicado es un análisis que se
// separa: el día que alguien tape aquí un truco nuevo de la autoridad, el otro
// se queda sin tapar y nadie se entera. Una sola lectura, dos listas.

/// Parte un `src` en (autoridad, ruta) si —y sólo si— es una URL que podemos
/// comparar con seguridad contra una lista blanca de hosts.
///
/// ESTRICTO, y cada regla tapa un ataque concreto:
///
/// - **Sólo `https:`**. Cae `http:`, cae `javascript:`, cae `data:` y cae el
///   protocolo-relativo `//host` — que hereda el esquema de la página y por eso
///   parece inofensivo, pero no dice quién lo sirve.
/// - **Se quitan TAB, LF y CR antes de mirar nada.** El navegador los borra de
///   una URL, así que un `https://ww\nw.google.com` LE llega como el host
///   bueno, y a un analizador ingenuo como otro distinto. Es el desacuerdo
///   clásico entre lo que el navegador pide y lo que nosotros miramos.
/// - **Cae cualquier `@` en la autoridad.** `https://www.google.com@evil.com/`
///   se lee como «usuario www.google.com en evil.com»: el navegador va a
///   evil.com y el ojo humano lee Google.
/// - **Cae cualquier `:`** — un puerto no aporta nada a un recurso de lista
///   blanca y evita discutir sobre `:443`.
/// - **Cae la barra invertida.** El navegador la normaliza a `/`, así que
///   `https://www.google.com\@evil.com` vuelve a ser el ataque de arriba.
/// - **Todo en minúsculas**, para que el host se compare EXACTO sin que
///   `HTTPS://CDN.TAILWINDCSS.COM` se escape por la caja.
///
/// La ruta devuelta empieza en el primer `/`, `?` o `#` — o es vacía si la URL
/// se acaba en la autoridad. Quien llama decide con qué prefijo la compara.
pub fn autoridad_y_ruta(src: &str) -> Option<(String, String)> {
    // El navegador ignora TAB, LF y CR al resolver una URL; nosotros también, o
    // estaríamos mirando una cadena distinta de la que él va a pedir.
    let limpio: String = src
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    let limpio = limpio.trim();
    if limpio.len() > 2000 {
        return None;
    }

    let bajo = limpio.to_ascii_lowercase();
    let resto = bajo.strip_prefix("https://")?;

    // La autoridad es todo hasta el primer `/`, `?` o `#`.
    let fin = resto
        .find(|c| c == '/' || c == '?' || c == '#')
        .unwrap_or(resto.len());
    let autoridad = &resto[..fin];
    if autoridad.is_empty() || autoridad.contains(['@', ':', '\\']) {
        return None;
    }

    Some((autoridad.to_string(), resto[fin..].to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parte_autoridad_y_ruta() {
        let (a, r) = autoridad_y_ruta("https://cdn.tailwindcss.com/3.4.16").unwrap();
        assert_eq!(a, "cdn.tailwindcss.com");
        assert_eq!(r, "/3.4.16");
    }

    #[test]
    fn sin_ruta_la_ruta_es_vacia() {
        let (a, r) = autoridad_y_ruta("https://cdn.tailwindcss.com").unwrap();
        assert_eq!(a, "cdn.tailwindcss.com");
        assert_eq!(r, "");
    }

    #[test]
    fn la_query_cuenta_como_ruta() {
        let (a, r) = autoridad_y_ruta("https://cdn.tailwindcss.com?plugins=forms").unwrap();
        assert_eq!(a, "cdn.tailwindcss.com");
        assert_eq!(r, "?plugins=forms");
    }

    #[test]
    fn caen_los_esquemas_que_no_son_https() {
        for src in [
            "http://cdn.tailwindcss.com",
            "//cdn.tailwindcss.com",
            "javascript:alert(1)",
            "data:text/html,x",
            "cdn.tailwindcss.com",
        ] {
            assert!(autoridad_y_ruta(src).is_none(), "debía caer: {src}");
        }
    }

    #[test]
    fn caen_los_trucos_de_la_autoridad() {
        for src in [
            "https://cdn.tailwindcss.com@evil.com/",
            r"https://cdn.tailwindcss.com\@evil.com/",
            "https://cdn.tailwindcss.com:8080/",
            "https://",
        ] {
            assert!(autoridad_y_ruta(src).is_none(), "debía caer: {src}");
        }
    }

    #[test]
    fn los_blancos_de_url_se_quitan_antes_de_mirar() {
        // El navegador pide cdn.tailwindcss.com; nosotros tenemos que ver lo mismo.
        let (a, _) = autoridad_y_ruta("https://cdn.tailwindcss\n.com").unwrap();
        assert_eq!(a, "cdn.tailwindcss.com");
    }

    #[test]
    fn la_caja_no_es_un_host_distinto() {
        let (a, r) = autoridad_y_ruta("HTTPS://CDN.TAILWINDCSS.COM/X").unwrap();
        assert_eq!(a, "cdn.tailwindcss.com");
        assert_eq!(r, "/x");
    }
}
