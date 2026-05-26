use kuchikiki::traits::TendrilSink;
use kuchikiki::{NodeData, NodeRef};

use super::OP_ID_ATTR;

const SECTION_TAGS: &[&str] = &[
    "section", "header", "footer", "main", "aside", "article", "nav",
];

const SKIP_TAGS_OUTLINE: &[&str] = &[
    "html", "head", "meta", "title", "link", "script", "style", "noscript", "br", "hr",
];

#[derive(Debug, Clone)]
pub struct ScopedView {
    pub scoped_html: String,
    pub container_op_id: String,
    pub outline: String,
    pub pin_is_container: bool,
}

/// Given a tagged document and a pin (an op-id known to exist), return a
/// scoped view: the pin's enclosing semantic container + an outline of all
/// other top-level sections. Lets the route send Kimi a tiny payload
/// instead of the entire taggedHtml.
///
/// Returns `None` when the document doesn't parse, the pin isn't found, or
/// there is no `<body>` (malformed doc). The caller then falls back to
/// sending the full tagged HTML.
pub fn build_scoped_view(tagged_html: &str, pinned_op_id: &str) -> Option<ScopedView> {
    if tagged_html.is_empty() || pinned_op_id.is_empty() {
        return None;
    }
    let doc = kuchikiki::parse_html().one(tagged_html);
    let escaped = pinned_op_id.replace('"', r#"\""#);
    let pin_selector = format!(r#"[{}="{}"]"#, OP_ID_ATTR, escaped);

    let mut pin_iter = doc.select(&pin_selector).ok()?;
    let pin_data_ref = pin_iter.next()?;
    let pin_node: NodeRef = pin_data_ref.as_node().clone();

    let body_data_ref = doc.select("body").ok()?.next()?;
    let body_node: NodeRef = body_data_ref.as_node().clone();

    // Walk up from the pin to find a semantic container. If we exhaust the
    // ancestor chain without one, fall back to the pin's nearest direct
    // child of <body>.
    let (container, pin_is_container) = match walk_to_section_container(&pin_node) {
        Some((n, is_pin)) => (n, is_pin),
        None => {
            // Find direct body-child ancestor (or use the pin itself).
            let direct = nearest_body_direct_child(&pin_node, &body_node);
            match direct {
                Some(n) => {
                    let is_pin = node_op_id(&n).as_deref() == Some(pinned_op_id);
                    (n, is_pin)
                }
                None => return None,
            }
        }
    };

    let container_op_id = node_op_id(&container)?;
    let scoped_html = serialize_node(&container);

    let mut lines: Vec<String> = Vec::new();
    for child in body_node.children() {
        if !is_element(&child) {
            continue;
        }
        let tag = match element_name(&child) {
            Some(t) => t,
            None => continue,
        };
        if SKIP_TAGS_OUTLINE
            .iter()
            .any(|s| s.eq_ignore_ascii_case(&tag))
        {
            continue;
        }
        let op_id = match node_op_id(&child) {
            Some(id) => id,
            None => continue,
        };
        let hint = top_heading_or_text(&child);
        let scoped_marker = if op_id == container_op_id {
            " (SCOPED)"
        } else {
            ""
        };
        if hint.is_empty() {
            lines.push(format!("- [{}] <{}>{}", op_id, tag, scoped_marker));
        } else {
            lines.push(format!(
                "- [{}] <{}> \"{}\"{}",
                op_id, tag, hint, scoped_marker
            ));
        }
    }

    Some(ScopedView {
        scoped_html,
        container_op_id,
        outline: lines.join("\n"),
        pin_is_container,
    })
}

fn walk_to_section_container(start: &NodeRef) -> Option<(NodeRef, bool)> {
    let mut current = start.clone();
    let mut is_pin = true;
    loop {
        if let Some(tag) = element_name(&current) {
            if SECTION_TAGS.iter().any(|s| s.eq_ignore_ascii_case(&tag)) {
                return Some((current, is_pin));
            }
        }
        is_pin = false;
        let parent = current.parent()?;
        if let Some(tag) = element_name(&parent) {
            let t = tag.to_ascii_lowercase();
            if t == "body" || t == "html" {
                return None;
            }
        }
        current = parent;
    }
}

fn nearest_body_direct_child(start: &NodeRef, body: &NodeRef) -> Option<NodeRef> {
    let mut current = start.clone();
    loop {
        let parent = current.parent()?;
        if std::rc::Rc::ptr_eq(&parent.0, &body.0) {
            return Some(current);
        }
        current = parent;
    }
}

fn node_op_id(node: &NodeRef) -> Option<String> {
    if let NodeData::Element(ref data) = node.data() {
        let attrs = data.attributes.borrow();
        attrs.get(OP_ID_ATTR).map(|s| s.to_string())
    } else {
        None
    }
}

fn is_element(node: &NodeRef) -> bool {
    matches!(node.data(), NodeData::Element(_))
}

fn element_name(node: &NodeRef) -> Option<String> {
    if let NodeData::Element(ref data) = node.data() {
        Some(data.name.local.to_string())
    } else {
        None
    }
}

fn top_heading_or_text(node: &NodeRef) -> String {
    for d in node.descendants() {
        if let Some(tag) = element_name(&d) {
            let t = tag.to_ascii_lowercase();
            if t == "h1" || t == "h2" || t == "h3" {
                return collapse(&text_of(&d), 60);
            }
        }
    }
    let text = text_of(node);
    let collapsed = collapse(&text, 60);
    if !collapsed.is_empty() {
        return collapsed;
    }
    if let NodeData::Element(ref data) = node.data() {
        let attrs = data.attributes.borrow();
        if let Some(id) = attrs.get("id") {
            return collapse(id, 60);
        }
        if let Some(cls) = attrs.get("class") {
            return collapse(cls, 60);
        }
    }
    String::new()
}

fn text_of(node: &NodeRef) -> String {
    let mut out = String::new();
    collect_text(node, &mut out);
    out
}

fn collect_text(node: &NodeRef, out: &mut String) {
    match node.data() {
        NodeData::Text(ref t) => out.push_str(&t.borrow()),
        NodeData::Element(_) => {
            for child in node.children() {
                collect_text(&child, out);
            }
        }
        _ => {}
    }
}

fn collapse(s: &str, max_chars: usize) -> String {
    let trimmed = s.trim();
    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(max_chars).collect()
}

fn serialize_node(node: &NodeRef) -> String {
    let mut out: Vec<u8> = Vec::new();
    if node.serialize(&mut out).is_err() {
        return String::new();
    }
    String::from_utf8(out).unwrap_or_default()
}
