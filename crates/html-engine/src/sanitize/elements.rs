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

use crate::error::EngineError;
use crate::sanitize::RemovedCounts;

const DANGEROUS_ELEMENTS: &[&str] = &["iframe", "object", "embed", "applet", "portal"];

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

    #[test]
    fn iframe_removed() {
        let mut r = RemovedCounts::default();
        let out =
            strip_dangerous_elements("<p>x</p><iframe src=\"//evil\"></iframe>", &mut r).unwrap();
        assert!(!out.contains("<iframe"));
        assert_eq!(r.iframes, 1);
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
