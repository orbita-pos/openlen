/// Cache-Control header value for a given file extension.
///
/// Three tiers:
/// - `.html` / `.htm` — short browser cache (60 s) + long CDN cache (1 h) with
///   stale-while-revalidate so deploys feel instant without blowing through
///   origin requests.
/// - Static assets (css/js/fonts/images/media) — 30 days `immutable` because
///   today the templates use deterministic filenames; once we hash assets this
///   stays correct.
/// - Anything else — `no-cache` so we don't accidentally cache config files,
///   JSON, robots.txt, sitemap.xml, etc. against a published deploy.
pub fn cache_control_for(extension: Option<&str>) -> &'static str {
    match extension.map(str::to_ascii_lowercase).as_deref() {
        Some("html") | Some("htm") => "max-age=60, s-maxage=3600, stale-while-revalidate=86400",
        Some("css") | Some("js") | Some("mjs") | Some("woff") | Some("woff2") | Some("ttf")
        | Some("otf") | Some("eot") | Some("png") | Some("jpg") | Some("jpeg") | Some("gif")
        | Some("webp") | Some("svg") | Some("ico") | Some("avif") | Some("mp4") | Some("webm")
        | Some("mp3") | Some("ogg") | Some("wasm") => "public, max-age=2592000, immutable",
        _ => "no-cache",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_uses_short_browser_cache_with_swr() {
        let h = cache_control_for(Some("html"));
        assert!(h.contains("max-age=60"));
        assert!(h.contains("s-maxage=3600"));
        assert!(h.contains("stale-while-revalidate=86400"));
    }

    #[test]
    fn htm_treated_like_html() {
        assert_eq!(
            cache_control_for(Some("htm")),
            cache_control_for(Some("html"))
        );
    }

    #[test]
    fn css_js_get_immutable_30d() {
        for ext in [
            "css", "js", "mjs", "woff2", "png", "jpg", "svg", "webp", "wasm",
        ] {
            let h = cache_control_for(Some(ext));
            assert!(h.contains("immutable"), "ext={ext}, header={h}");
            assert!(h.contains("max-age=2592000"), "ext={ext}, header={h}");
        }
    }

    #[test]
    fn case_insensitive_extension() {
        assert_eq!(
            cache_control_for(Some("HTML")),
            cache_control_for(Some("html"))
        );
        assert_eq!(
            cache_control_for(Some("PNG")),
            cache_control_for(Some("png"))
        );
    }

    #[test]
    fn unknown_extension_uses_no_cache() {
        assert_eq!(cache_control_for(Some("xml")), "no-cache");
        assert_eq!(cache_control_for(Some("json")), "no-cache");
        assert_eq!(cache_control_for(Some("txt")), "no-cache");
    }

    #[test]
    fn no_extension_uses_no_cache() {
        assert_eq!(cache_control_for(None), "no-cache");
    }
}
