// Deterministic text extraction / reinjection for one-click multilingual
// publishing (Speak Every Language). The contract that makes this safe:
//
//   extract_translatables(html)            -> Vec<String>   (document order)
//   reinject_translatables(html, texts, l) -> Option<String>
//
// BOTH functions walk the SAME parsed DOM with the SAME collector, so the
// n-th extracted string and the n-th translated string always address the
// same slot — no markers in the markup, no fuzzy matching, and the page's
// structure/classes/animations stay byte-identical (the fidelity lesson
// from the Canva rollback). A length mismatch returns None and the caller
// skips that locale rather than shipping a half-translated page.
//
// Translatable slots, in document order:
//   - text nodes outside script/style/code/pre/svg/etc. with at least one
//     alphabetic char (pure numbers/symbols pass through untouched);
//     leading/trailing whitespace is preserved on reinjection so inline
//     spacing never collapses
//   - a fixed set of human-visible attributes: alt, title, placeholder,
//     aria-label, submit/button input values, and the content of the
//     description/OG/Twitter meta tags
//
// Reinjection also stamps <html lang> with the target locale. Empty
// translations keep the original string (defensive against a model
// returning blanks).

use kuchikiki::traits::TendrilSink;
use kuchikiki::{NodeData, NodeRef};

const EXCLUDED_TAGS: [&str; 12] = [
    "script", "style", "noscript", "template", "code", "pre", "kbd", "samp", "var", "textarea",
    "svg", "math",
];

const PLAIN_ATTRS: [&str; 4] = ["alt", "title", "placeholder", "aria-label"];

const META_NAMES: [&str; 4] = ["description", "keywords", "twitter:title", "twitter:description"];
const META_PROPERTIES: [&str; 4] = ["og:title", "og:description", "og:site_name", "og:image:alt"];

enum Slot {
    Text(NodeRef),
    Attr(NodeRef, &'static str),
}

fn has_alpha(s: &str) -> bool {
    s.chars().any(|c| c.is_alphabetic())
}

fn tag_name(node: &NodeRef) -> Option<String> {
    match node.data() {
        NodeData::Element(d) => Some(d.name.local.as_ref().to_string()),
        _ => None,
    }
}

fn in_excluded_subtree(node: &NodeRef) -> bool {
    let mut current = node.parent();
    while let Some(p) = current {
        if let Some(tag) = tag_name(&p) {
            if EXCLUDED_TAGS.contains(&tag.as_str()) {
                return true;
            }
        }
        current = p.parent();
    }
    false
}

fn meta_is_translatable(node: &NodeRef) -> bool {
    let NodeData::Element(d) = node.data() else { return false };
    let attrs = d.attributes.borrow();
    if let Some(name) = attrs.get("name") {
        if META_NAMES.contains(&name.to_ascii_lowercase().as_str()) {
            return true;
        }
    }
    if let Some(prop) = attrs.get("property") {
        if META_PROPERTIES.contains(&prop.to_ascii_lowercase().as_str()) {
            return true;
        }
    }
    false
}

fn input_value_is_translatable(node: &NodeRef) -> bool {
    let NodeData::Element(d) = node.data() else { return false };
    let attrs = d.attributes.borrow();
    attrs
        .get("type")
        .map(|t| {
            let t = t.to_ascii_lowercase();
            t == "submit" || t == "button" || t == "reset"
        })
        .unwrap_or(false)
}

/// Walk the document once and return every translatable slot in order.
/// extract and reinject MUST both go through here — the shared walk is the
/// whole addressing scheme.
fn collect_slots(doc: &NodeRef) -> Vec<Slot> {
    let mut slots: Vec<Slot> = Vec::new();
    for node in doc.inclusive_descendants() {
        match node.data() {
            NodeData::Text(text) => {
                if in_excluded_subtree(&node) {
                    continue;
                }
                let t = text.borrow();
                let trimmed = t.trim();
                if trimmed.is_empty() || !has_alpha(trimmed) {
                    continue;
                }
                drop(t);
                slots.push(Slot::Text(node.clone()));
            }
            NodeData::Element(d) => {
                if in_excluded_subtree(&node) {
                    continue;
                }
                let tag = d.name.local.as_ref().to_string();
                let attrs = d.attributes.borrow();
                for name in PLAIN_ATTRS {
                    if let Some(v) = attrs.get(name) {
                        if has_alpha(v.trim()) {
                            slots.push(Slot::Attr(node.clone(), name));
                        }
                    }
                }
                let content_ok = match tag.as_str() {
                    "meta" => meta_is_translatable(&node),
                    _ => false,
                };
                if content_ok {
                    if let Some(v) = attrs.get("content") {
                        if has_alpha(v.trim()) {
                            slots.push(Slot::Attr(node.clone(), "content"));
                        }
                    }
                }
                if tag == "input" && input_value_is_translatable(&node) {
                    if let Some(v) = attrs.get("value") {
                        if has_alpha(v.trim()) {
                            slots.push(Slot::Attr(node.clone(), "value"));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    slots
}

fn slot_text(slot: &Slot) -> String {
    match slot {
        Slot::Text(node) => match node.data() {
            NodeData::Text(t) => t.borrow().trim().to_string(),
            _ => String::new(),
        },
        Slot::Attr(node, name) => match node.data() {
            NodeData::Element(d) => d
                .attributes
                .borrow()
                .get(*name)
                .map(|v| v.trim().to_string())
                .unwrap_or_default(),
            _ => String::new(),
        },
    }
}

/// Every translatable string of the document, in document order.
pub fn extract_translatables(html: &str) -> Vec<String> {
    let doc = kuchikiki::parse_html().one(html);
    collect_slots(&doc).iter().map(slot_text).collect()
}

/// Replace the document's translatable strings (extracted by
/// `extract_translatables` from the SAME html) with `texts`, preserving the
/// original leading/trailing whitespace of text nodes, and stamp
/// `<html lang>`. Returns None when the slot count doesn't match — the
/// caller must treat that as "skip this locale".
pub fn reinject_translatables(html: &str, texts: &[String], lang: &str) -> Option<String> {
    let doc = kuchikiki::parse_html().one(html);
    let slots = collect_slots(&doc);
    if slots.len() != texts.len() {
        return None;
    }

    for (slot, translated) in slots.iter().zip(texts.iter()) {
        let translated = translated.trim();
        if translated.is_empty() {
            continue; // defensive: a blank translation keeps the original
        }
        match slot {
            Slot::Text(node) => {
                if let NodeData::Text(t) = node.data() {
                    let mut cell = t.borrow_mut();
                    let original: &str = &cell;
                    let lead_len = original.len() - original.trim_start().len();
                    let trail_len = original.len() - original.trim_end().len();
                    let lead = &original[..lead_len];
                    let trail = &original[original.len() - trail_len..];
                    let next = format!("{}{}{}", lead, translated, trail);
                    *cell = next;
                }
            }
            Slot::Attr(node, name) => {
                if let NodeData::Element(d) = node.data() {
                    d.attributes
                        .borrow_mut()
                        .insert(*name, translated.to_string());
                }
            }
        }
    }

    if let Ok(html_el) = doc.select_first("html") {
        if let NodeData::Element(d) = html_el.as_node().data() {
            d.attributes.borrow_mut().insert("lang", lang.to_string());
        }
    }

    Some(super::serialize_doc(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = r#"<html lang="es"><head>
<title>Mi panadería</title>
<meta name="description" content="Pan artesanal cada mañana.">
<meta property="og:title" content="Mi panadería">
<meta name="viewport" content="width=device-width">
<style>body { color: red; }</style>
</head><body>
<h1>  Bienvenidos  </h1>
<p>Horneamos <strong>pan fresco</strong> todos los días.</p>
<img src="/assets/pan.webp" alt="Pan recién horneado">
<input type="submit" value="Enviar">
<input type="text" value="no traducir">
<span>2026</span>
<script>console.log('hola mundo');</script>
<pre>codigo literal</pre>
</body></html>"#;

    #[test]
    fn extracts_text_attrs_and_meta_in_document_order() {
        let texts = extract_translatables(PAGE);
        assert_eq!(
            texts,
            vec![
                "Mi panadería",
                "Pan artesanal cada mañana.",
                "Mi panadería",
                "Bienvenidos",
                "Horneamos",
                "pan fresco",
                "todos los días.",
                "Pan recién horneado",
                "Enviar",
            ]
        );
    }

    #[test]
    fn skips_scripts_styles_pre_numbers_and_nontranslatable_attrs() {
        let texts = extract_translatables(PAGE);
        let joined = texts.join("|");
        assert!(!joined.contains("hola mundo"));
        assert!(!joined.contains("codigo literal"));
        assert!(!joined.contains("color: red"));
        assert!(!joined.contains("2026"));
        assert!(!joined.contains("no traducir"));
        assert!(!joined.contains("width=device-width"));
    }

    #[test]
    fn reinjection_replaces_every_slot_and_sets_lang() {
        let texts = extract_translatables(PAGE);
        let translated: Vec<String> = texts.iter().map(|t| format!("FR:{}", t)).collect();
        let out = reinject_translatables(PAGE, &translated, "fr").unwrap();
        assert!(out.contains(r#"lang="fr""#));
        assert!(out.contains("FR:Bienvenidos"));
        assert!(out.contains("FR:pan fresco"));
        assert!(out.contains(r#"alt="FR:Pan recién horneado""#));
        assert!(out.contains(r#"content="FR:Pan artesanal cada mañana.""#));
        assert!(out.contains(r#"value="FR:Enviar""#));
        // Untranslated content untouched.
        assert!(out.contains("console.log('hola mundo')"));
        assert!(out.contains("2026"));
        assert!(out.contains(r#"value="no traducir""#));
    }

    #[test]
    fn whitespace_around_text_nodes_is_preserved() {
        let texts = extract_translatables(PAGE);
        let translated: Vec<String> = texts
            .iter()
            .map(|t| {
                if t == "Bienvenidos" {
                    "Welcome".to_string()
                } else {
                    t.clone()
                }
            })
            .collect();
        let out = reinject_translatables(PAGE, &translated, "en").unwrap();
        assert!(out.contains("<h1>  Welcome  </h1>"));
    }

    #[test]
    fn identity_reinjection_keeps_all_text() {
        let texts = extract_translatables(PAGE);
        let out = reinject_translatables(PAGE, &texts, "es").unwrap();
        let roundtrip = extract_translatables(&out);
        assert_eq!(texts, roundtrip);
    }

    #[test]
    fn count_mismatch_returns_none() {
        let texts = vec!["solo uno".to_string()];
        assert!(reinject_translatables(PAGE, &texts, "fr").is_none());
    }

    #[test]
    fn blank_translation_keeps_the_original() {
        let texts = extract_translatables(PAGE);
        let mut translated = texts.clone();
        translated[3] = "   ".to_string(); // Bienvenidos slot
        let out = reinject_translatables(PAGE, &translated, "fr").unwrap();
        assert!(out.contains("Bienvenidos"));
    }

    #[test]
    fn inline_markup_structure_survives() {
        let texts = extract_translatables(PAGE);
        let translated: Vec<String> = texts.iter().map(|t| format!("X{}", t)).collect();
        let out = reinject_translatables(PAGE, &translated, "fr").unwrap();
        assert!(out.contains("<strong>Xpan fresco</strong>"));
        assert!(out.contains(r#"src="/assets/pan.webp""#));
    }
}
