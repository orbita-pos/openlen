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
//   - style-src stays unset: inline <style> + style attributes are load-
//     bearing on every page; the lockdown value here is script execution.
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

pub fn seal_release(html: &str, form_action_extra: Option<&str>) -> SealResult {
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
        let policy = build_policy(&script_hashes, &external_scripts, form_action_extra);
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
        let NodeData::Element(d) = a.data() else { continue };
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
            let NodeData::Element(d) = s.data() else { continue };
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
    } else if let Some(r) = src.strip_prefix("http://") {
        ("http://", r)
    } else {
        return None;
    };
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..host_end];
    if host.is_empty() {
        return None;
    }
    Some(format!("{}{}", scheme, host.to_ascii_lowercase()))
}

fn build_policy(
    hashes: &[String],
    externals: &[String],
    form_action_extra: Option<&str>,
) -> String {
    let script_src = if hashes.is_empty() && externals.is_empty() {
        "'none'".to_string()
    } else {
        let mut sources: Vec<&str> = hashes.iter().map(String::as_str).collect();
        sources.extend(externals.iter().map(String::as_str));
        sources.join(" ")
    };
    let form_action = match form_action_extra {
        Some(origin) if !origin.trim().is_empty() => format!("'self' {}", origin.trim()),
        _ => "'self'".to_string(),
    };
    format!(
        "script-src {}; object-src 'none'; base-uri 'none'; form-action {}",
        script_src, form_action
    )
}

/// Insert the policy meta right after `<meta charset>` when present (charset
/// should stay first in head), else as the first child of <head>.
fn inject_csp_meta(doc: &NodeRef, policy: &str) {
    let Ok(head) = doc.select_first("head") else { return };
    let head_node = head.as_node().clone();
    let meta_html = format!(
        r#"<meta http-equiv="Content-Security-Policy" content="{}" data-ol-csp>"#,
        escape_attr(policy)
    );
    let nodes = parse_fragment_children(&meta_html);

    let charset = doc.select("meta[charset]").ok().and_then(|mut it| it.next());
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
        format!("'sha256-{}'", BASE64.encode(Sha256::digest(text.as_bytes())))
    }

    #[test]
    fn scriptless_page_gets_script_src_none() {
        let html = r#"<html><head><meta charset="utf-8"></head><body><p>hi</p></body></html>"#;
        let r = seal_release(html, None);
        assert!(r.sealed);
        assert!(r.html.contains("script-src 'none'"));
        assert!(r.html.contains("object-src 'none'"));
        assert!(r.html.contains("base-uri 'none'"));
        assert!(r.html.contains("form-action 'self'"));
        assert!(r.html.contains("data-ol-csp"));
    }

    #[test]
    fn inline_script_hash_lands_in_policy() {
        let body = "console.log('hola');";
        let html = format!(
            r#"<html><head></head><body><script>{}</script></body></html>"#,
            body
        );
        let r = seal_release(&html, None);
        assert!(r.sealed);
        assert_eq!(r.script_hashes, vec![hash_token(body)]);
        assert!(r.html.contains(&hash_token(body).replace('\'', "'")));
    }

    #[test]
    fn raw_text_script_with_operators_hashes_exact_bytes() {
        let body = "if(a<b&&c>0){fetch('/c/x',{keepalive:true})}";
        let html = format!(r#"<body><script>{}</script></body>"#, body);
        let r = seal_release(&html, None);
        assert!(r.sealed);
        assert_eq!(r.script_hashes, vec![hash_token(body)]);
        // Serialization must not have altered the script body (self-check
        // would have caught it, but assert directly too).
        assert!(r.html.contains(body));
    }

    #[test]
    fn external_cdn_script_allowlisted_by_origin() {
        let html = r#"<head><script src="https://cdn.tailwindcss.com"></script></head><body></body>"#;
        let r = seal_release(html, None);
        assert!(r.sealed);
        assert_eq!(r.external_scripts, vec!["https://cdn.tailwindcss.com"]);
        assert!(r.html.contains("script-src https://cdn.tailwindcss.com;"));
    }

    #[test]
    fn mixed_inline_and_external_both_in_policy() {
        let html = r#"<head><script src="https://cdn.tailwindcss.com/"></script></head><body><script>x()</script></body>"#;
        let r = seal_release(html, None);
        assert!(r.sealed);
        assert!(r.html.contains(&hash_token("x()")));
        assert!(r.html.contains("https://cdn.tailwindcss.com"));
    }

    #[test]
    fn duplicate_inline_scripts_hash_once() {
        let html = r#"<body><script>same()</script><script>same()</script></body>"#;
        let r = seal_release(html, None);
        assert_eq!(r.script_hashes.len(), 1);
    }

    #[test]
    fn base_tags_stripped() {
        let html = r#"<html><head><base href="https://evil.example/"></head><body></body></html>"#;
        let r = seal_release(html, None);
        assert_eq!(r.bases_stripped, 1);
        assert!(!r.html.contains("<base"));
    }

    #[test]
    fn target_blank_gains_noopener_preserving_rel_tokens() {
        let html = r#"<body><a href="https://x.com" target="_blank" rel="nofollow">x</a><a href="/in" target="_self">y</a></body>"#;
        let r = seal_release(html, None);
        assert_eq!(r.noopener_added, 1);
        assert!(r.html.contains(r#"rel="nofollow noopener""#));
    }

    #[test]
    fn existing_noopener_not_duplicated() {
        let html = r#"<body><a href="https://x.com" target="_blank" rel="noopener">x</a></body>"#;
        let r = seal_release(html, None);
        assert_eq!(r.noopener_added, 0);
        assert_eq!(r.html.matches("noopener").count(), 1);
    }

    #[test]
    fn form_action_extra_origin_included() {
        let html = "<html><head></head><body></body></html>";
        let r = seal_release(html, Some("https://openlen.com"));
        assert!(r.html.contains("form-action 'self' https://openlen.com"));
    }

    #[test]
    fn author_csp_meta_leaves_page_unsealed_but_hardened() {
        let html = r#"<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><base href="/x"></head><body></body></html>"#;
        let r = seal_release(html, None);
        assert!(!r.sealed);
        assert!(!r.html.contains("data-ol-csp"));
        assert!(r.html.contains("default-src 'self'")); // author meta intact
        assert_eq!(r.bases_stripped, 1);
        assert_eq!(r.errors.len(), 1);
    }

    #[test]
    fn relative_script_src_bails_without_meta() {
        let html = r#"<body><script src="/js/app.js"></script></body>"#;
        let r = seal_release(html, None);
        assert!(!r.sealed);
        assert!(!r.html.contains("data-ol-csp"));
        assert_eq!(r.errors.len(), 1);
    }

    #[test]
    fn meta_placed_after_charset() {
        let html = r#"<html><head><meta charset="utf-8"><title>t</title></head><body></body></html>"#;
        let r = seal_release(html, None);
        let charset_pos = r.html.find("charset").unwrap();
        let csp_pos = r.html.find("data-ol-csp").unwrap();
        let title_pos = r.html.find("<title>").unwrap();
        assert!(charset_pos < csp_pos && csp_pos < title_pos);
    }

    #[test]
    fn meta_first_in_head_without_charset() {
        let html = r#"<html><head><title>t</title></head><body></body></html>"#;
        let r = seal_release(html, None);
        let csp_pos = r.html.find("data-ol-csp").unwrap();
        let title_pos = r.html.find("<title>").unwrap();
        assert!(csp_pos < title_pos);
    }

    #[test]
    fn reseal_is_idempotent() {
        let html = r#"<html><head><meta charset="utf-8"></head><body><a href="https://x.com" target="_blank">x</a><script>go()</script></body></html>"#;
        let once = seal_release(html, Some("https://openlen.com"));
        let twice = seal_release(&once.html, Some("https://openlen.com"));
        assert!(twice.sealed);
        assert_eq!(once.html, twice.html);
        assert_eq!(once.html.matches("data-ol-csp").count(), 1);
    }

    #[test]
    fn policy_survives_attribute_escaping_roundtrip() {
        // The policy value carries single quotes — they must serialize intact
        // inside the double-quoted content attribute.
        let html = r#"<body><script>q()</script></body>"#;
        let r = seal_release(html, None);
        assert!(r.html.contains("content=\"script-src 'sha256-"));
    }
}
