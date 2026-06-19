// Born With Imagery — fill the gradient image-placeholders an AI-generated
// page ships with (design-guidance bans real image URLs, so heroes are
// `<div class="bg-gradient-to-br …">`) with real curated photos.
//
// The model marks pure image areas with `data-ol-photo="<subject>"` (a 2-4
// word subject hint it writes because it has the most context). This pass:
//   extract_photo_slots(html)            -> Vec<PhotoSlot>  (document order)
//   apply_photo_slots(html, &assignments)-> ApplyResult
// both walk the SAME `[data-ol-photo]` selection, so slot i ↔ assignment i.
//
// v1 only photographs EMPTY slots (no text descendants) — a pure image box.
// A gradient div with a headline overlaid stays a gradient, sidestepping the
// text-contrast problem entirely; assignment.src="" leaves such a slot (and
// any slot with no good match) untouched. The injected <img> is absolutely
// positioned to fill the slot, carries the manifest's responsive srcset, and
// the slot is made position:relative / overflow:hidden so it clips cleanly.
// The gradient class stays as the load/404 fallback behind the image.

use kuchikiki::traits::TendrilSink;
use kuchikiki::{NodeData, NodeRef};

use super::{escape_attr, parse_fragment_children, serialize_doc};

#[derive(Debug, Clone)]
pub struct PhotoSlot {
    /// The model's subject hint (the `data-ol-photo` value).
    pub subject: String,
    /// True when the slot has visible text descendants — v1 skips these.
    pub has_text: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PhotoAssignment {
    /// Largest variant → the `src`. Empty string = leave this slot untouched.
    pub src: String,
    /// Responsive srcset (manifest widths). Empty when `src` is empty.
    pub srcset: String,
    pub alt: String,
}

#[derive(Debug, Default)]
pub struct ApplyResult {
    pub html: String,
    pub applied: u32,
}

fn has_alpha_text(node: &NodeRef) -> bool {
    for d in node.inclusive_descendants() {
        if let NodeData::Text(t) = d.data() {
            if t.borrow().chars().any(|c| c.is_alphabetic()) {
                return true;
            }
        }
    }
    false
}

fn slot_nodes(doc: &NodeRef) -> Vec<NodeRef> {
    match doc.select("[data-ol-photo]") {
        Ok(it) => it.map(|n| n.as_node().clone()).collect(),
        Err(_) => Vec::new(),
    }
}

pub fn extract_photo_slots(html: &str) -> Vec<PhotoSlot> {
    let doc = kuchikiki::parse_html().one(html);
    slot_nodes(&doc)
        .iter()
        .map(|node| {
            let subject = match node.data() {
                NodeData::Element(d) => d
                    .attributes
                    .borrow()
                    .get("data-ol-photo")
                    .unwrap_or("")
                    .trim()
                    .to_string(),
                _ => String::new(),
            };
            PhotoSlot {
                subject,
                has_text: has_alpha_text(node),
            }
        })
        .collect()
}

pub fn apply_photo_slots(html: &str, assignments: &[PhotoAssignment]) -> ApplyResult {
    let doc = kuchikiki::parse_html().one(html);
    let slots = slot_nodes(&doc);
    if slots.is_empty() || slots.len() != assignments.len() {
        // Length mismatch (e.g. the HTML changed between extract and apply) →
        // don't risk mis-targeting; return the input verbatim.
        return ApplyResult {
            html: html.to_string(),
            applied: 0,
        };
    }

    let mut applied = 0u32;
    for (node, a) in slots.iter().zip(assignments.iter()) {
        // Always drop the marker so it never reaches disk, even when skipped.
        if let NodeData::Element(d) = node.data() {
            d.attributes.borrow_mut().remove("data-ol-photo");
        }
        if a.src.is_empty() {
            continue;
        }

        // Make the slot a positioned, clipping container (append to any
        // existing inline style so author styles survive).
        if let NodeData::Element(d) = node.data() {
            let mut attrs = d.attributes.borrow_mut();
            let prev = attrs.get("style").unwrap_or("").trim().to_string();
            let mut style = prev.clone();
            if !style.is_empty() && !style.ends_with(';') {
                style.push(';');
            }
            style.push_str("position:relative;overflow:hidden");
            attrs.insert("style", style);
        }

        let img = format!(
            r#"<img src="{}" srcset="{}" sizes="100vw" alt="{}" loading="lazy" decoding="async" data-ol-photo-img style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">"#,
            escape_attr(&a.src),
            escape_attr(&a.srcset),
            escape_attr(&a.alt),
        );
        // Prepend so the image sits behind any (decorative) existing children.
        let frag = parse_fragment_children(&img);
        for n in frag.into_iter().rev() {
            node.prepend(n);
        }
        applied += 1;
    }

    ApplyResult {
        html: serialize_doc(&doc),
        applied,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assign(src: &str) -> PhotoAssignment {
        if src.is_empty() {
            return PhotoAssignment::default();
        }
        PhotoAssignment {
            src: format!("https://images.openlen.com/{}-1920.webp", src),
            srcset: format!(
                "https://images.openlen.com/{0}-400.webp 400w, https://images.openlen.com/{0}-800.webp 800w, https://images.openlen.com/{0}-1920.webp 1920w",
                src
            ),
            alt: format!("{} photo", src),
        }
    }

    #[test]
    fn extracts_subjects_and_text_flag_in_order() {
        let html = r#"<body>
            <div data-ol-photo="fresh tacos"></div>
            <div data-ol-photo="modern office"><h2>We work here</h2></div>
        </body>"#;
        let slots = extract_photo_slots(html);
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].subject, "fresh tacos");
        assert!(!slots[0].has_text);
        assert_eq!(slots[1].subject, "modern office");
        assert!(slots[1].has_text);
    }

    #[test]
    fn no_slots_returns_input_verbatim() {
        let html = "<body><div class=\"bg-gradient-to-br\"></div></body>";
        let r = apply_photo_slots(html, &[]);
        assert_eq!(r.html, html);
        assert_eq!(r.applied, 0);
    }

    #[test]
    fn injects_img_into_empty_slot_and_drops_marker() {
        let html = r#"<body><div class="bg-gradient-to-br h-96" data-ol-photo="fresh tacos"></div></body>"#;
        let r = apply_photo_slots(html, &[assign("tacos")]);
        assert_eq!(r.applied, 1);
        assert!(r.html.contains("data-ol-photo-img"));
        assert!(r
            .html
            .contains("https://images.openlen.com/tacos-1920.webp"));
        assert!(r.html.contains("srcset="));
        assert!(r.html.contains("object-fit:cover"));
        assert!(r.html.contains("position:relative;overflow:hidden"));
        // The marker attribute is gone; the gradient class stays as fallback.
        assert!(!r.html.contains("data-ol-photo=\""));
        assert!(r.html.contains("bg-gradient-to-br"));
    }

    #[test]
    fn skips_slots_with_text_but_still_drops_marker() {
        let html = r#"<body><div data-ol-photo="office"><h1>Hello</h1></div></body>"#;
        // TS sends an empty assignment for a has_text slot.
        let r = apply_photo_slots(html, &[assign("")]);
        assert_eq!(r.applied, 0);
        assert!(!r.html.contains("data-ol-photo-img"));
        assert!(!r.html.contains("data-ol-photo=\""));
        assert!(r.html.contains("<h1>Hello</h1>"));
    }

    #[test]
    fn empty_assignment_leaves_unmatched_slot_as_gradient() {
        let html =
            r#"<body><div class="bg-gradient-to-br" data-ol-photo="quokka on mars"></div></body>"#;
        let r = apply_photo_slots(html, &[assign("")]);
        assert_eq!(r.applied, 0);
        assert!(!r.html.contains("<img"));
        assert!(r.html.contains("bg-gradient-to-br"));
    }

    #[test]
    fn existing_inline_style_is_preserved() {
        let html = r#"<body><div style="border-radius:16px" data-ol-photo="tacos"></div></body>"#;
        let r = apply_photo_slots(html, &[assign("tacos")]);
        assert!(r.html.contains("border-radius:16px"));
        assert!(r.html.contains("position:relative;overflow:hidden"));
    }

    #[test]
    fn length_mismatch_returns_input_verbatim() {
        let html = r#"<body><div data-ol-photo="a"></div><div data-ol-photo="b"></div></body>"#;
        let r = apply_photo_slots(html, &[assign("tacos")]); // 1 assignment, 2 slots
        assert_eq!(r.applied, 0);
        assert!(r.html.contains("data-ol-photo="));
    }

    #[test]
    fn multiple_slots_get_their_matched_photo() {
        let html = r#"<body>
            <div data-ol-photo="tacos"></div>
            <div data-ol-photo="office"><p>text</p></div>
            <div data-ol-photo="nature"></div>
        </body>"#;
        let r = apply_photo_slots(html, &[assign("food"), assign(""), assign("forest")]);
        assert_eq!(r.applied, 2);
        assert!(r.html.contains("food-1920.webp"));
        assert!(r.html.contains("forest-1920.webp"));
        assert!(!r.html.contains("data-ol-photo=\""));
    }

    #[test]
    fn img_carries_lazy_and_alt() {
        let html = r#"<body><div data-ol-photo="tacos"></div></body>"#;
        let r = apply_photo_slots(html, &[assign("tacos")]);
        assert!(r.html.contains(r#"loading="lazy""#));
        assert!(r.html.contains(r#"alt="tacos photo""#));
    }
}
