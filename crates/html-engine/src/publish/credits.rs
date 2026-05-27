// Defense-in-depth Unsplash attribution consolidation at publish time.
//
// The editor inserts a visible `<span data-openlen-credit="unsplash">` next
// to every Unsplash image picked via the search tab — that satisfies
// Unsplash's "visible credit" guideline for the picker flow. But three
// failure modes can break that single line of defense:
//   1. A user CSS rule (or chat edit) hides / removes the credit span while
//      leaving the photo on the page.
//   2. Pasted-URL Unsplash images never get an attribution span at all.
//   3. Curated templates / pasted-HTML projects can hard-code
//      images.unsplash.com URLs with no credit DOM.
//
// To stay TOS-compliant regardless, we scan the doc at publish and:
//   - Inject one `<meta name="image-source">` per detected photographer in
//     <head> — machine-readable, immune to user CSS, survives any visual
//     change.
//   - Inject one screen-reader-only `<aside data-openlen-credits-aggregate>`
//     at end-of-body with a `<ul>` of every credit + a generic "Photos from
//     Unsplash" line when anonymous CDN URLs are detected.
//
// Idempotent: every prior consolidation artifact (the aggregate aside, the
// image-source meta tags) is stripped before fresh ones are written, so the
// credit set always reflects the current image set — removing a photo also
// removes its credit on next publish.

use kuchikiki::traits::TendrilSink;
use kuchikiki::{NodeData, NodeRef};
use once_cell::sync::Lazy;
use regex::Regex;

use super::{escape_attr_strict, escape_html, parse_fragment_children, serialize_doc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsplashCredit {
    pub author: String,
    pub author_url: String,
}

#[derive(Debug, Clone)]
pub struct ConsolidationResult {
    pub html: String,
    /// Distinct photographers attributed via inline credit spans. Document
    /// order, deduplicated by `author_url`.
    pub credits: Vec<UnsplashCredit>,
    /// Number of `images.unsplash.com` images that had no adjacent credit
    /// span (paste-URL or template-baked). Aggregated as a generic Unsplash
    /// mention rather than a per-photo line.
    pub anonymous_unsplash_count: u32,
}

const UNSPLASH_HOME: &str = "https://unsplash.com/?utm_source=openlen&utm_medium=referral";

static UNSPLASH_CDN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)https?://images\.unsplash\.com/").expect("valid unsplash cdn regex")
});

pub fn consolidate_unsplash_credits(html: &str) -> ConsolidationResult {
    if html.trim().is_empty() {
        return ConsolidationResult {
            html: html.to_string(),
            credits: vec![],
            anonymous_unsplash_count: 0,
        };
    }

    let doc = kuchikiki::parse_html().one(html);

    // Strip any prior consolidation artifacts so the credit set reflects the
    // current image set, not an ever-growing accumulation.
    if let Ok(aggs) = doc.select("[data-openlen-credits-aggregate]") {
        for n in aggs.collect::<Vec<_>>() {
            n.as_node().detach();
        }
    }
    if let Ok(metas) = doc.select(r#"head meta[name="image-source"]"#) {
        for n in metas.collect::<Vec<_>>() {
            n.as_node().detach();
        }
    }

    // Harvest distinct photographers from inline credit spans. Dedup by
    // author URL so the same photo applied twice doesn't credit twice.
    // Preserve document order by tracking a Vec alongside the dedupe set.
    let mut credits: Vec<UnsplashCredit> = Vec::new();
    let mut seen_urls: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Ok(spans) = doc.select(r#"[data-openlen-credit="unsplash"]"#) {
        for span in spans {
            let first_anchor = span
                .as_node()
                .descendants()
                .find(|n| {
                    matches!(
                        n.data(),
                        NodeData::Element(d) if d.name.local.as_ref() == "a"
                    )
                });
            let anchor = match first_anchor {
                Some(a) => a,
                None => continue,
            };
            let author = collect_text(&anchor).trim().to_string();
            if author.is_empty() {
                continue;
            }
            let author_url = match anchor.data() {
                NodeData::Element(d) => d
                    .attributes
                    .borrow()
                    .get("href")
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default(),
                _ => String::new(),
            };
            if author_url.is_empty() {
                continue;
            }
            if seen_urls.insert(author_url.clone()) {
                credits.push(UnsplashCredit {
                    author,
                    author_url,
                });
            }
        }
    }

    // Count anonymous Unsplash images — CDN URL with no immediately-adjacent
    // credit span. Conservative: only the very next ELEMENT sibling counts as
    // "adjacent" because that's where use-image-replace.ts pins ours; a
    // paste-URL image has no such sibling and gets counted.
    let mut anonymous_unsplash_count: u32 = 0;
    if let Ok(imgs) = doc.select("img") {
        for img in imgs {
            let src = img
                .attributes
                .borrow()
                .get("src")
                .unwrap_or("")
                .to_string();
            if !UNSPLASH_CDN_RE.is_match(&src) {
                continue;
            }
            if let Some(next) = next_element_sibling(img.as_node()) {
                if let NodeData::Element(d) = next.data() {
                    let attrs = d.attributes.borrow();
                    let is_credit = attrs
                        .get("data-openlen-credit")
                        .map(|s| s == "unsplash")
                        .unwrap_or(false);
                    if is_credit {
                        continue;
                    }
                }
            }
            anonymous_unsplash_count += 1;
        }
    }

    // Nothing to inject — serialize what we have (which already had any prior
    // artifacts stripped, so a re-run on a previously-credited doc with all
    // photos removed correctly clears the prior aggregate).
    if credits.is_empty() && anonymous_unsplash_count == 0 {
        return ConsolidationResult {
            html: serialize_doc(&doc),
            credits,
            anonymous_unsplash_count,
        };
    }

    // Inject machine-readable meta tags into <head>.
    if let Ok(head) = doc.select_first("head") {
        let head_node = head.as_node().clone();
        for c in &credits {
            let meta_html = format!(
                r#"<meta name="image-source" content="{} via Unsplash ({})">"#,
                escape_attr_strict(&c.author),
                escape_attr_strict(&c.author_url),
            );
            for n in parse_fragment_children(&meta_html) {
                head_node.append(n);
            }
        }
        if anonymous_unsplash_count > 0 {
            let meta_html = format!(
                r#"<meta name="image-source" content="Anonymous Unsplash photo(s) ({}) via {}">"#,
                anonymous_unsplash_count, UNSPLASH_HOME,
            );
            for n in parse_fragment_children(&meta_html) {
                head_node.append(n);
            }
        }
    }

    // Inject screen-reader aside into <body>.
    if let Ok(body) = doc.select_first("body") {
        let body_node = body.as_node().clone();
        let mut items: Vec<String> = credits
            .iter()
            .map(|c| {
                format!(
                    r#"<li>Photo by <a href="{}" rel="noopener">{}</a> on <a href="{}" rel="noopener">Unsplash</a></li>"#,
                    escape_attr_strict(&c.author_url),
                    escape_html(&c.author),
                    UNSPLASH_HOME,
                )
            })
            .collect();
        if anonymous_unsplash_count > 0 {
            items.push(format!(
                r#"<li>Additional photo(s) from <a href="{}" rel="noopener">Unsplash</a></li>"#,
                UNSPLASH_HOME,
            ));
        }
        let aside_html = format!(
            r#"<aside data-openlen-credits-aggregate aria-label="Image credits" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"><h2 style="font-size:1em;margin:0">Image credits</h2><ul style="margin:0;padding:0;list-style:none">{}</ul></aside>"#,
            items.join("")
        );
        for n in parse_fragment_children(&aside_html) {
            body_node.append(n);
        }
    }

    ConsolidationResult {
        html: serialize_doc(&doc),
        credits,
        anonymous_unsplash_count,
    }
}

fn collect_text(node: &NodeRef) -> String {
    let mut out = String::new();
    walk_text(node, &mut out);
    out
}

fn walk_text(node: &NodeRef, out: &mut String) {
    match node.data() {
        NodeData::Text(t) => out.push_str(&t.borrow()),
        NodeData::Element(_) => {
            for child in node.children() {
                walk_text(&child, out);
            }
        }
        _ => {}
    }
}

fn next_element_sibling(node: &NodeRef) -> Option<NodeRef> {
    let mut current = node.next_sibling();
    while let Some(n) = current {
        if matches!(n.data(), NodeData::Element(_)) {
            return Some(n);
        }
        current = n.next_sibling();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(html: &str) -> ConsolidationResult {
        consolidate_unsplash_credits(html)
    }

    #[test]
    fn empty_input_returns_original() {
        let r = run("");
        assert_eq!(r.html, "");
        assert!(r.credits.is_empty());
        assert_eq!(r.anonymous_unsplash_count, 0);
    }

    #[test]
    fn whitespace_only_returns_original() {
        let r = run("   ");
        assert_eq!(r.html, "   ");
        assert!(r.credits.is_empty());
    }

    #[test]
    fn no_unsplash_content_no_injection() {
        let html = r#"<html><head></head><body><img src="/local.png"></body></html>"#;
        let r = run(html);
        assert!(r.credits.is_empty());
        assert_eq!(r.anonymous_unsplash_count, 0);
        // No aggregate aside, no image-source meta.
        assert!(!r.html.contains("data-openlen-credits-aggregate"));
        assert!(!r.html.contains(r#"name="image-source""#));
    }

    #[test]
    fn harvests_inline_credit_span() {
        let html = r#"<html><head></head><body>
            <img src="https://images.unsplash.com/photo-123">
            <span data-openlen-credit="unsplash">
              Photo by <a href="https://unsplash.com/@alice">Alice</a> on Unsplash
            </span>
        </body></html>"#;
        let r = run(html);
        assert_eq!(r.credits.len(), 1);
        assert_eq!(r.credits[0].author, "Alice");
        assert_eq!(r.credits[0].author_url, "https://unsplash.com/@alice");
        // The credited image is NOT counted as anonymous because the span is
        // the image's immediately-next ELEMENT sibling.
        assert_eq!(r.anonymous_unsplash_count, 0);
        // Aside and meta were injected.
        assert!(r.html.contains("data-openlen-credits-aggregate"));
        assert!(r
            .html
            .contains(r#"<meta name="image-source" content="Alice via Unsplash"#));
    }

    #[test]
    fn dedupes_by_author_url() {
        let html = r#"<body>
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@alice">Alice</a></span>
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@alice">Alice</a></span>
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@bob">Bob</a></span>
        </body>"#;
        let r = run(html);
        assert_eq!(r.credits.len(), 2);
        assert_eq!(r.credits[0].author, "Alice");
        assert_eq!(r.credits[1].author, "Bob");
    }

    #[test]
    fn counts_anonymous_unsplash_image() {
        let html = r#"<body>
            <img src="https://images.unsplash.com/photo-XYZ">
        </body>"#;
        let r = run(html);
        assert_eq!(r.anonymous_unsplash_count, 1);
        assert!(r.credits.is_empty());
        // The anonymous-count meta + aggregate are still injected.
        assert!(r.html.contains("Anonymous Unsplash photo(s) (1)"));
        assert!(r.html.contains("Additional photo(s) from"));
    }

    #[test]
    fn anonymous_count_only_when_no_adjacent_credit_span() {
        let html = r#"<body>
            <img src="https://images.unsplash.com/photo-A">
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@a">A</a></span>
            <img src="https://images.unsplash.com/photo-B">
        </body>"#;
        let r = run(html);
        // First img has a credit span as next sibling → credited, not anonymous.
        // Second img has nothing adjacent → anonymous.
        assert_eq!(r.anonymous_unsplash_count, 1);
        assert_eq!(r.credits.len(), 1);
    }

    #[test]
    fn ignores_non_cdn_image() {
        let html = r#"<body>
            <img src="/local/photo.jpg">
            <img src="https://example.com/x.png">
            <img src="https://images.unsplash.com/real">
        </body>"#;
        let r = run(html);
        // Only the images.unsplash.com one counts.
        assert_eq!(r.anonymous_unsplash_count, 1);
    }

    #[test]
    fn cdn_url_case_insensitive() {
        let html = r#"<body><img src="HTTPS://Images.Unsplash.COM/photo"></body>"#;
        let r = run(html);
        assert_eq!(r.anonymous_unsplash_count, 1);
    }

    #[test]
    fn skips_credit_span_with_no_anchor() {
        let html = r#"<body>
            <span data-openlen-credit="unsplash">no anchor here</span>
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@a">A</a></span>
        </body>"#;
        let r = run(html);
        assert_eq!(r.credits.len(), 1);
    }

    #[test]
    fn skips_credit_span_with_empty_author_or_url() {
        let html = r#"<body>
            <span data-openlen-credit="unsplash"><a href="">No URL</a></span>
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@x"></a></span>
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@good">Good</a></span>
        </body>"#;
        let r = run(html);
        assert_eq!(r.credits.len(), 1);
        assert_eq!(r.credits[0].author, "Good");
    }

    #[test]
    fn idempotent_strips_prior_artifacts_before_writing() {
        let html = r#"<body>
            <img src="https://images.unsplash.com/photo-A">
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@a">A</a></span>
        </body>"#;
        let once = run(html);
        let twice = run(&once.html);
        // Counts match between runs (the strip+rewrite produced the same set).
        assert_eq!(once.credits, twice.credits);
        assert_eq!(once.anonymous_unsplash_count, twice.anonymous_unsplash_count);
        // No duplicate meta or aggregate elements.
        assert_eq!(
            twice
                .html
                .matches(r#"name="image-source""#)
                .count(),
            once.html.matches(r#"name="image-source""#).count(),
        );
        assert_eq!(twice.html.matches("data-openlen-credits-aggregate").count(), 1);
    }

    #[test]
    fn removed_photo_clears_prior_credit_on_rerun() {
        // First run credits a photo, second run is called on a doc whose
        // photo + span are gone — the prior aggregate + meta must be cleared.
        let with_photo = r#"<body>
            <img src="https://images.unsplash.com/p">
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@a">A</a></span>
        </body>"#;
        let first = run(with_photo);
        // Simulate the user removing both the img and the span but keeping the
        // injected artifacts (as would happen on the next publish after an
        // edit). Just rerun on the first result with the span+img stripped.
        let stripped = first
            .html
            .replace(
                r#"<img src="https://images.unsplash.com/p">"#,
                "",
            )
            .replace(
                r#"<span data-openlen-credit="unsplash"><a href="https://unsplash.com/@a">A</a></span>"#,
                "",
            );
        let second = run(&stripped);
        // Prior aggregate gone.
        assert!(!second.html.contains("data-openlen-credits-aggregate"));
        assert!(!second.html.contains(r#"name="image-source""#));
        assert!(second.credits.is_empty());
        assert_eq!(second.anonymous_unsplash_count, 0);
    }

    #[test]
    fn escapes_html_in_author_name_and_url() {
        let html = r#"<body>
            <img src="https://images.unsplash.com/p">
            <span data-openlen-credit="unsplash"><a href="https://unsplash.com/@x?a=1&amp;b=2">A&lt;B</a></span>
        </body>"#;
        let r = run(html);
        assert_eq!(r.credits.len(), 1);
        assert_eq!(r.credits[0].author, "A<B");
        assert_eq!(r.credits[0].author_url, "https://unsplash.com/@x?a=1&b=2");
        // Aside body text (PCDATA context) gets `<` and `&` entity-encoded.
        assert!(r.html.contains("A&lt;B"));
        // The attribute value preserves the ampersand as `&amp;` (mandatory
        // in HTML attribute values). `<` in an attribute value is left literal
        // — that's per HTML5 spec (it's only `>` that's reserved-ish, and
        // html5ever's serializer doesn't escape it either). The DOM round-trips
        // either way; what matters is that on a re-parse, the value still
        // decodes to "A<B via Unsplash (...)". So we don't assert byte-equality
        // on the meta content here.
        assert!(r.html.contains("a=1&amp;b=2"));
    }

    #[test]
    fn injects_anonymous_only_when_count_positive() {
        // No credits, no anonymous → no anonymous meta line either.
        let html = r#"<body><p>nothing</p></body>"#;
        let r = run(html);
        assert!(!r.html.contains("Anonymous Unsplash"));
        assert!(!r.html.contains("Additional photo"));
    }
}
