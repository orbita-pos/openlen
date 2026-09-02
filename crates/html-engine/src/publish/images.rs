// Publish-time responsive-image rewrite. The TS side (lib/publish/
// image-bake.ts) resolves each <img src> to locally-generated multi-width
// WebP variants and hands us a manifest; this pass mutates the DOM so the
// published page serves right-sized images:
//
//   - src → the largest local variant, srcset → all variant widths
//   - sizes: "100vw" (eager) / "auto, 100vw" (lazy — `auto` lets supporting
//     browsers use the laid-out width; older ones skip the unknown token and
//     fall through to 100vw)
//   - width/height from the variant's intrinsic dimensions (kills CLS) —
//     only when the author set neither
//   - the first matched image with intrinsic width ≥ HERO_MIN_WIDTH that the
//     author didn't lazy-load is treated as the LCP hero: fetchpriority=high
//     + a <link rel=preload imagesrcset> in <head>; every matched image
//     AFTER the hero defaults to loading=lazy + decoding=async
//
// Author intent always wins: images that already carry a srcset (hand-tuned
// templates), live inside <picture>, or have explicit loading / dimension
// attributes are never overridden. The editor HTML stays untouched — only
// the published output carries this.

use kuchikiki::traits::TendrilSink;
use kuchikiki::NodeData;

use super::{escape_attr, parse_fragment_children, serialize_doc};

/// Below this intrinsic width an image can't be the LCP hero (logos, icons,
/// avatars) — it still gets srcset + dimensions, just not the preload.
const HERO_MIN_WIDTH: u32 = 800;

/// Tolerancia antes de declarar que una caja recorta "más alto" que la foto.
/// Un 16:10 dentro de 16:9 no amerita renunciar al ahorro de `sizes="auto"`.
const COVER_ASPECT_SLACK: f64 = 1.15;

/// `sizes="auto"` elige la variante por el ANCHO pintado del <img>. Con
/// `object-cover` dentro de una caja más ALTA que la foto (tarjeta 3:4 sobre
/// foto 16:9 — el patrón de toda galería vertical), la imagen se escala por
/// ALTURA: el ancho fuente que de verdad se usa es alto × aspecto intrínseco,
/// y el navegador — ciego al recorte — elige corto. Medido en prod: fotos
/// pintadas al 42% de su resolución. Estas funciones detectan ese caso desde
/// el markup (utilidades `aspect-*` de Tailwind o `aspect-ratio:` inline, en
/// el <img> o un ancestro cercano) para degradar a `100vw` — el mismo sizes
/// de los eager, nítido a cambio de sobre-descargar. Solo se renuncia a
/// `auto` cuando el recorte es DEMOSTRABLE; sin señal, el ahorro se queda.
fn parse_ratio(s: &str) -> Option<f64> {
    let s = s.trim();
    if let Some((a, b)) = s.split_once('/') {
        let a: f64 = a.trim().parse().ok()?;
        let b: f64 = b.trim().parse().ok()?;
        return (a > 0.0 && b > 0.0).then(|| a / b);
    }
    let v: f64 = s.parse().ok()?;
    (v > 0.0).then_some(v)
}

fn parse_aspect_token(tok: &str) -> Option<f64> {
    // `lg:aspect-[3/4]` — el prefijo de breakpoint no importa: si ALGÚN
    // breakpoint recorta más alto, elegir corto arruina ese breakpoint, y el
    // costo de acertar de más es solo bytes.
    let tok = tok.rsplit(':').next().unwrap_or(tok);
    let rest = tok.strip_prefix("aspect-")?;
    match rest {
        "square" => Some(1.0),
        "video" => Some(16.0 / 9.0),
        "auto" => None,
        _ => parse_ratio(rest.strip_prefix('[')?.strip_suffix(']')?),
    }
}

fn element_aspect(attrs: &kuchikiki::Attributes) -> Option<f64> {
    if let Some(class) = attrs.get("class") {
        if let Some(r) = class.split_whitespace().find_map(parse_aspect_token) {
            return Some(r);
        }
    }
    let style = attrs.get("style")?;
    let lower = style.to_ascii_lowercase();
    let i = lower.find("aspect-ratio")?;
    let after = lower[i + "aspect-ratio".len()..].trim_start();
    let val: String = after
        .strip_prefix(':')?
        .chars()
        .take_while(|c| *c != ';')
        .collect();
    parse_ratio(&val)
}

/// Aspecto de la caja que recorta: el del propio <img>, o el del ancestro con
/// aspecto declarado más cercano (el patrón real es el wrapper inmediato —
/// `<div class="aspect-[3/4]"><img object-cover>` — 4 niveles bastan).
fn cover_box_aspect(node: &kuchikiki::NodeRef, own: &kuchikiki::Attributes) -> Option<f64> {
    if let Some(r) = element_aspect(own) {
        return Some(r);
    }
    node.ancestors().take(4).find_map(|anc| match anc.data() {
        NodeData::Element(d) => element_aspect(&d.attributes.borrow()),
        _ => None,
    })
}

#[derive(Debug, Clone)]
pub struct ResponsiveImage {
    /// Entity-decoded `src` attribute value this entry applies to.
    pub src: String,
    /// Largest local variant — becomes the new `src`.
    pub fallback_src: String,
    /// Complete srcset value, e.g. `/assets/ab12-400w.webp 400w, …`.
    pub srcset: String,
    /// Intrinsic dimensions of the largest variant (aspect-ratio source).
    pub width: u32,
    pub height: u32,
    /// AVIF srcset (same widths as `srcset`), present only when AVIF variants
    /// were baked. When set, the <img> is wrapped in a <picture> with an AVIF
    /// <source> (+ a WebP <source>) so modern browsers fetch the smaller AVIF;
    /// when None the <img srcset> path (WebP only) is used unchanged.
    pub avif_srcset: Option<String>,
}

#[derive(Debug, Default)]
pub struct RewriteImagesResult {
    pub html: String,
    /// Images whose src/srcset we rewrote from the manifest.
    pub rewritten: u32,
    /// Images that gained loading="lazy".
    pub lazied: u32,
    /// Original src of the detected LCP hero, when one was found.
    pub hero_src: Option<String>,
}

pub fn rewrite_responsive_images(html: &str, images: &[ResponsiveImage]) -> RewriteImagesResult {
    let unchanged = |html: &str| RewriteImagesResult {
        html: html.to_string(),
        ..Default::default()
    };
    if images.is_empty() {
        return unchanged(html);
    }

    let doc = kuchikiki::parse_html().one(html);
    let imgs: Vec<_> = match doc.select("img") {
        Ok(it) => it.collect(),
        Err(_) => return unchanged(html),
    };
    if imgs.is_empty() {
        // Byte-equal contract (same as wire_published_forms): nothing to do →
        // don't round-trip the document through kuchikiki.
        return unchanged(html);
    }

    let mut rewritten = 0u32;
    let mut lazied = 0u32;
    let mut hero: Option<&ResponsiveImage> = None;
    let mut hero_seen = false;

    for img in &imgs {
        let node = img.as_node().clone();
        // <picture> parents own format negotiation via <source>; an img-level
        // srcset would fight them.
        let in_picture = node
            .parent()
            .map(|p| match p.data() {
                NodeData::Element(d) => d.name.local.as_ref() == "picture",
                _ => false,
            })
            .unwrap_or(false);

        let NodeData::Element(d) = node.data() else {
            continue;
        };
        let mut attrs = d.attributes.borrow_mut();

        if in_picture || attrs.get("srcset").is_some() {
            continue;
        }
        let Some(entry) = attrs
            .get("src")
            .and_then(|src| images.iter().find(|e| e.src == src))
        else {
            continue;
        };

        let author_lazy = attrs
            .get("loading")
            .map(|v| v.eq_ignore_ascii_case("lazy"))
            .unwrap_or(false);
        let is_hero = !hero_seen && entry.width >= HERO_MIN_WIDTH && !author_lazy;

        // object-cover en caja demostrablemente más alta que la foto: el ancho
        // pintado (lo único que `auto` mira) subestima la fuente necesaria.
        let cropped_taller = attrs
            .get("class")
            .map(|c| c.split_whitespace().any(|t| t == "object-cover"))
            .unwrap_or(false)
            && cover_box_aspect(&node, &attrs)
                .map(|box_ar| {
                    entry.width as f64 / entry.height.max(1) as f64 > box_ar * COVER_ASPECT_SLACK
                })
                .unwrap_or(false);

        // Hero + anything above it (eager) renders at most viewport-wide.
        let sizes = if is_hero || (!hero_seen && !author_lazy) || cropped_taller {
            "100vw"
        } else {
            "auto, 100vw"
        };

        attrs.insert("src", entry.fallback_src.clone());
        // With AVIF the <picture><source>s carry srcset/sizes; a bare <img>
        // keeps them so non-<picture> rendering still gets responsive WebP.
        if entry.avif_srcset.is_none() {
            attrs.insert("srcset", entry.srcset.clone());
            attrs.insert("sizes", sizes.to_string());
        }
        if attrs.get("width").is_none() && attrs.get("height").is_none() {
            attrs.insert("width", entry.width.to_string());
            attrs.insert("height", entry.height.to_string());
        }

        if is_hero {
            hero_seen = true;
            hero = Some(entry);
            if attrs.get("fetchpriority").is_none() {
                attrs.insert("fetchpriority", "high".to_string());
            }
        } else if hero_seen {
            if attrs.get("loading").is_none() {
                attrs.insert("loading", "lazy".to_string());
                lazied += 1;
            }
            if attrs.get("decoding").is_none() {
                attrs.insert("decoding", "async".to_string());
            }
        }
        drop(attrs);

        // AVIF → wrap the <img> in a <picture> so a supporting browser fetches
        // the smaller AVIF, falling back to the WebP <source>, then the <img>.
        if let Some(avif) = entry.avif_srcset.as_deref() {
            let picture_html = format!(
                concat!(
                    r#"<picture><source type="image/avif" srcset="{}" sizes="{}">"#,
                    r#"<source type="image/webp" srcset="{}" sizes="{}"></picture>"#,
                ),
                escape_attr(avif),
                escape_attr(sizes),
                escape_attr(&entry.srcset),
                escape_attr(sizes),
            );
            if let Some(picture) = parse_fragment_children(&picture_html).into_iter().next() {
                node.insert_before(picture.clone());
                picture.append(node.clone());
            }
        }
        rewritten += 1;
    }

    if rewritten == 0 {
        return unchanged(html);
    }

    // Preload the hero's srcset so the fetch starts before layout. No `href`
    // fallback on purpose: a browser without imagesrcset support would
    // preload the largest variant and then fetch a smaller one from srcset —
    // a guaranteed double download. The marker gates re-injection.
    if let Some(entry) = hero {
        let already = doc
            .select("link[data-ol-img-preload]")
            .map(|mut it| it.next().is_some())
            .unwrap_or(false);
        if !already {
            if let Ok(head) = doc.select_first("head") {
                // Preload the format the browser will actually fetch: type-gated
                // AVIF when baked (so non-AVIF browsers skip it instead of
                // double-downloading), else the WebP srcset.
                let link = match entry.avif_srcset.as_deref() {
                    Some(avif) => format!(
                        r#"<link rel="preload" as="image" type="image/avif" imagesrcset="{}" imagesizes="100vw" fetchpriority="high" data-ol-img-preload>"#,
                        escape_attr(avif)
                    ),
                    None => format!(
                        r#"<link rel="preload" as="image" imagesrcset="{}" imagesizes="100vw" fetchpriority="high" data-ol-img-preload>"#,
                        escape_attr(&entry.srcset)
                    ),
                };
                let head_node = head.as_node().clone();
                for n in parse_fragment_children(&link) {
                    head_node.append(n);
                }
            }
        }
    }

    RewriteImagesResult {
        html: serialize_doc(&doc),
        rewritten,
        lazied,
        hero_src: hero.map(|e| e.src.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(src: &str, width: u32, height: u32) -> ResponsiveImage {
        ResponsiveImage {
            src: src.to_string(),
            fallback_src: format!("/assets/hash-{}w.webp", width),
            srcset: format!(
                "/assets/hash-400w.webp 400w, /assets/hash-{}w.webp {}w",
                width, width
            ),
            width,
            height,
            avif_srcset: None,
        }
    }

    fn entry_avif(src: &str, width: u32, height: u32) -> ResponsiveImage {
        ResponsiveImage {
            avif_srcset: Some(format!(
                "/assets/hash-400w.avif 400w, /assets/hash-{}w.avif {}w",
                width, width
            )),
            ..entry(src, width, height)
        }
    }

    #[test]
    fn empty_manifest_returns_original_string() {
        let html = r#"<body><img src="/a.jpg"></body>"#;
        let r = rewrite_responsive_images(html, &[]);
        assert_eq!(r.html, html);
        assert_eq!(r.rewritten, 0);
    }

    #[test]
    fn no_imgs_returns_original_string() {
        let html = "<html><head></head><body><p>text</p></body></html>";
        let r = rewrite_responsive_images(html, &[entry("/a.jpg", 1600, 900)]);
        assert_eq!(r.html, html);
    }

    #[test]
    fn unmatched_src_returns_original_string() {
        let html = r#"<body><img src="/other.jpg"></body>"#;
        let r = rewrite_responsive_images(html, &[entry("/a.jpg", 1600, 900)]);
        assert_eq!(r.html, html);
        assert_eq!(r.rewritten, 0);
    }

    #[test]
    fn matched_img_gets_srcset_sizes_and_dimensions() {
        let html = r#"<body><img src="/a.jpg" alt="hero"></body>"#;
        let r = rewrite_responsive_images(html, &[entry("/a.jpg", 1600, 900)]);
        assert_eq!(r.rewritten, 1);
        assert!(r.html.contains(r#"src="/assets/hash-1600w.webp""#));
        assert!(r
            .html
            .contains(r#"srcset="/assets/hash-400w.webp 400w, /assets/hash-1600w.webp 1600w""#));
        assert!(r.html.contains(r#"sizes="100vw""#));
        assert!(r.html.contains(r#"width="1600""#));
        assert!(r.html.contains(r#"height="900""#));
        assert!(r.html.contains(r#"alt="hero""#));
    }

    #[test]
    fn first_large_image_is_hero_with_fetchpriority_and_preload() {
        let html = r#"<html><head></head><body><img src="/a.jpg"><img src="/b.jpg"></body></html>"#;
        let r = rewrite_responsive_images(
            html,
            &[entry("/a.jpg", 1600, 900), entry("/b.jpg", 1600, 900)],
        );
        assert_eq!(r.hero_src.as_deref(), Some("/a.jpg"));
        assert!(r.html.contains(r#"fetchpriority="high""#));
        assert!(r.html.contains("data-ol-img-preload"));
        assert!(r.html.contains(r#"imagesizes="100vw""#));
        // The preload has no href fallback.
        let link_start = r.html.find("data-ol-img-preload").unwrap();
        let link = &r.html[link_start.saturating_sub(200)..link_start];
        assert!(!link.contains("href="));
    }

    #[test]
    fn images_after_hero_get_lazy_and_async() {
        let html = r#"<html><head></head><body><img src="/a.jpg"><img src="/b.jpg"></body></html>"#;
        let r = rewrite_responsive_images(
            html,
            &[entry("/a.jpg", 1600, 900), entry("/b.jpg", 1600, 900)],
        );
        assert_eq!(r.lazied, 1);
        let b_pos = r.html.find("hash-1600w.webp 1600w").unwrap();
        let after_hero = &r.html[b_pos..];
        assert!(after_hero.contains(r#"loading="lazy""#));
        assert!(after_hero.contains(r#"decoding="async""#));
        assert!(after_hero.contains(r#"sizes="auto, 100vw""#));
    }

    #[test]
    fn small_image_before_hero_is_not_hero_and_not_lazied() {
        let html =
            r#"<html><head></head><body><img src="/logo.png"><img src="/a.jpg"></body></html>"#;
        let r = rewrite_responsive_images(
            html,
            &[entry("/logo.png", 200, 80), entry("/a.jpg", 1600, 900)],
        );
        assert_eq!(r.hero_src.as_deref(), Some("/a.jpg"));
        // The logo got rewritten but stays eager (no loading attr).
        assert_eq!(r.rewritten, 2);
        let logo_tag_start = r.html.find("hash-200w.webp").unwrap();
        let logo_tag = &r.html[logo_tag_start..logo_tag_start + 250];
        assert!(!logo_tag.contains(r#"loading="lazy""#));
    }

    #[test]
    fn author_lazy_hero_is_skipped_for_hero_selection() {
        let html = r#"<html><head></head><body><img src="/a.jpg" loading="lazy"><img src="/b.jpg"></body></html>"#;
        let r = rewrite_responsive_images(
            html,
            &[entry("/a.jpg", 1600, 900), entry("/b.jpg", 1600, 900)],
        );
        assert_eq!(r.hero_src.as_deref(), Some("/b.jpg"));
        // /a.jpg keeps its author lazy attribute.
        assert!(r.html.contains(r#"loading="lazy""#));
    }

    #[test]
    fn no_hero_when_all_images_small_or_lazy() {
        let html = r#"<html><head></head><body><img src="/logo.png"></body></html>"#;
        let r = rewrite_responsive_images(html, &[entry("/logo.png", 200, 80)]);
        assert_eq!(r.hero_src, None);
        assert!(!r.html.contains("data-ol-img-preload"));
        assert!(!r.html.contains("fetchpriority"));
    }

    #[test]
    fn author_srcset_is_never_touched() {
        let html = r#"<body><img src="/a.jpg" srcset="/a-sm.jpg 400w" sizes="50vw"></body>"#;
        let r = rewrite_responsive_images(html, &[entry("/a.jpg", 1600, 900)]);
        assert_eq!(r.html, html);
        assert_eq!(r.rewritten, 0);
    }

    #[test]
    fn img_inside_picture_is_never_touched() {
        let html = r#"<body><picture><source srcset="/a.avif"><img src="/a.jpg"></picture></body>"#;
        let r = rewrite_responsive_images(html, &[entry("/a.jpg", 1600, 900)]);
        assert_eq!(r.html, html);
    }

    #[test]
    fn author_dimensions_preserved() {
        let html = r#"<body><img src="/a.jpg" width="640" height="360"></body>"#;
        let r = rewrite_responsive_images(html, &[entry("/a.jpg", 1600, 900)]);
        assert!(r.html.contains(r#"width="640""#));
        assert!(r.html.contains(r#"height="360""#));
        assert!(!r.html.contains(r#"width="1600""#));
    }

    #[test]
    fn entity_encoded_src_matches_decoded_manifest_key() {
        // Raw HTML carries &amp; — kuchikiki hands us the decoded value, and
        // the TS side builds manifest keys from the decoded URL.
        let html = r#"<body><img src="https://images.unsplash.com/photo?a=1&amp;w=2"></body>"#;
        let r = rewrite_responsive_images(
            html,
            &[entry(
                "https://images.unsplash.com/photo?a=1&w=2",
                1600,
                900,
            )],
        );
        assert_eq!(r.rewritten, 1);
        assert!(r.html.contains("/assets/hash-1600w.webp"));
    }

    #[test]
    fn preload_marker_not_duplicated() {
        let html = r#"<html><head><link data-ol-img-preload rel="preload" as="image" imagesrcset="/x.webp 400w"></head><body><img src="/a.jpg"></body></html>"#;
        let r = rewrite_responsive_images(html, &[entry("/a.jpg", 1600, 900)]);
        assert_eq!(r.html.matches("data-ol-img-preload").count(), 1);
    }

    #[test]
    fn second_run_is_idempotent() {
        let html = r#"<html><head></head><body><img src="/a.jpg"><img src="/b.jpg"></body></html>"#;
        let manifest = [entry("/a.jpg", 1600, 900), entry("/b.jpg", 1600, 900)];
        let once = rewrite_responsive_images(html, &manifest);
        // Second run: srcs now point at variants (no manifest match) and every
        // touched img carries a srcset → skipped. Byte-equal output.
        let twice = rewrite_responsive_images(&once.html, &manifest);
        assert_eq!(once.html, twice.html);
        assert_eq!(twice.rewritten, 0);
    }

    #[test]
    fn avif_entry_wraps_img_in_picture_with_typed_sources_and_preload() {
        let html = r#"<html><head></head><body><img src="/a.jpg" alt="hero"></body></html>"#;
        let r = rewrite_responsive_images(html, &[entry_avif("/a.jpg", 1600, 900)]);
        assert_eq!(r.rewritten, 1);
        assert!(r.html.contains("<picture>"));
        assert!(r.html.contains(
            r#"<source type="image/avif" srcset="/assets/hash-400w.avif 400w, /assets/hash-1600w.avif 1600w" sizes="100vw">"#
        ));
        assert!(r.html.contains(
            r#"<source type="image/webp" srcset="/assets/hash-400w.webp 400w, /assets/hash-1600w.webp 1600w" sizes="100vw">"#
        ));
        // The <img> keeps src/dims/alt but carries NO srcset (the sources own it).
        assert!(r.html.contains(r#"src="/assets/hash-1600w.webp""#));
        assert!(r.html.contains(r#"alt="hero""#));
        let img_start = r.html.find("<img").unwrap();
        let img_end = img_start + r.html[img_start..].find('>').unwrap();
        let img_tag = &r.html[img_start..=img_end];
        assert!(
            !img_tag.contains("srcset"),
            "img must not carry srcset: {img_tag}"
        );
        // Hero preload is AVIF-typed.
        assert!(r.html.contains(
            r#"<link rel="preload" as="image" type="image/avif" imagesrcset="/assets/hash-400w.avif 400w, /assets/hash-1600w.avif 1600w""#
        ));
    }

    #[test]
    fn avif_picture_is_idempotent() {
        let html = r#"<html><head></head><body><img src="/a.jpg"></body></html>"#;
        let manifest = [entry_avif("/a.jpg", 1600, 900)];
        let once = rewrite_responsive_images(html, &manifest);
        // Second run: the <img> now lives inside <picture> → skipped (in_picture).
        let twice = rewrite_responsive_images(&once.html, &manifest);
        assert_eq!(once.html, twice.html);
        assert_eq!(twice.rewritten, 0);
    }

    // ── Recorte cover en caja más alta (el bug de las galerías borrosas) ────
    // Un lazy post-hero normalmente lleva sizes="auto, 100vw"; estos casos
    // fijan cuándo se degrada a "100vw" y cuándo NO se pierde el ahorro.

    /// Documento con hero previo, para que la img bajo prueba sea lazy.
    fn doc_with(hero_then: &str) -> String {
        format!(r#"<body><img src="/hero.jpg">{}</body>"#, hero_then)
    }

    fn entries_hero_and(second: ResponsiveImage) -> Vec<ResponsiveImage> {
        vec![entry("/hero.jpg", 1600, 900), second]
    }

    #[test]
    fn cover_in_taller_box_drops_auto() {
        // El caso Kira medido en prod: tarjeta 3:4, foto 16:9, cover → 42% res.
        let html = doc_with(
            r#"<div class="aspect-[3/4] rounded-xl"><img src="/a.jpg" class="w-full h-full object-cover"></div>"#,
        );
        let r = rewrite_responsive_images(&html, &entries_hero_and(entry("/a.jpg", 1600, 900)));
        let after_hero = &r.html[r.html.find("aspect-").unwrap()..];
        assert!(after_hero.contains(r#"sizes="100vw""#));
        assert!(!after_hero.contains("auto, 100vw"));
    }

    #[test]
    fn cover_matching_aspect_keeps_auto() {
        // Caja 16:9 sobre foto 16:9: el ancho pintado sí manda — ahorro intacto.
        let html =
            doc_with(r#"<div class="aspect-video"><img src="/a.jpg" class="object-cover"></div>"#);
        let r = rewrite_responsive_images(&html, &entries_hero_and(entry("/a.jpg", 1600, 900)));
        assert!(r.html.contains("auto, 100vw"));
    }

    #[test]
    fn taller_box_without_cover_keeps_auto() {
        // Sin object-cover no hay recorte: contain/fill pintan por ancho.
        let html = doc_with(r#"<div class="aspect-[3/4]"><img src="/a.jpg" class="w-full"></div>"#);
        let r = rewrite_responsive_images(&html, &entries_hero_and(entry("/a.jpg", 1600, 900)));
        assert!(r.html.contains("auto, 100vw"));
    }

    #[test]
    fn aspect_on_img_itself_and_breakpoint_prefix_count() {
        // lg:aspect-[9/16] en el propio <img>: si un breakpoint recorta más
        // alto, elegir corto arruina ese breakpoint — se degrada.
        let html = doc_with(r#"<img src="/a.jpg" class="lg:aspect-[9/16] object-cover">"#);
        let r = rewrite_responsive_images(&html, &entries_hero_and(entry("/a.jpg", 1600, 900)));
        let after_hero = &r.html[r.html.find("lg:aspect").unwrap()..];
        assert!(!after_hero.contains("auto, 100vw"));
    }

    #[test]
    fn inline_aspect_ratio_style_counts() {
        let html = doc_with(
            r#"<div style="aspect-ratio: 3 / 4"><img src="/a.jpg" class="object-cover"></div>"#,
        );
        let r = rewrite_responsive_images(&html, &entries_hero_and(entry("/a.jpg", 1600, 900)));
        let after_hero = &r.html[r.html.find("aspect-ratio").unwrap()..];
        assert!(!after_hero.contains("auto, 100vw"));
    }

    #[test]
    fn cover_without_any_aspect_signal_keeps_auto() {
        // Sin señal del aspecto de la caja no se especula: el ahorro se queda.
        let html = doc_with(r#"<img src="/a.jpg" class="object-cover w-full">"#);
        let r = rewrite_responsive_images(&html, &entries_hero_and(entry("/a.jpg", 1600, 900)));
        assert!(r.html.contains("auto, 100vw"));
    }

    #[test]
    fn slack_tolerates_near_matches() {
        // 16:10 dentro de 16:9 (7% de diferencia): dentro de la tolerancia.
        let html = doc_with(
            r#"<div class="aspect-[16/10]"><img src="/a.jpg" class="object-cover"></div>"#,
        );
        let r = rewrite_responsive_images(&html, &entries_hero_and(entry("/a.jpg", 1600, 900)));
        assert!(r.html.contains("auto, 100vw"));
    }

    #[test]
    fn avif_picture_sources_inherit_degraded_sizes() {
        // La ruta <picture> (AVIF) lleva sizes en los <source>: mismo criterio.
        let html =
            doc_with(r#"<div class="aspect-[3/4]"><img src="/a.jpg" class="object-cover"></div>"#);
        let r =
            rewrite_responsive_images(&html, &entries_hero_and(entry_avif("/a.jpg", 1600, 900)));
        let after_hero = &r.html[r.html.find("aspect-").unwrap()..];
        assert!(after_hero.contains(r#"<source type="image/avif""#));
        assert!(!after_hero.contains("auto, 100vw"));
    }
}
