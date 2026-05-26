use std::cell::Cell;

use lol_html::{element, rewrite_str, RewriteStrSettings};

use super::id::base36;
use super::OP_ID_ATTR;
use crate::error::EngineError;

/// Tags lol-html visits but the model never references — head metadata, raw
/// text containers (script/style), and pure-presentational singletons. Mirror
/// of the SKIP_TAGS set in lib/html-ops.ts; keep in lock-step so the tagged
/// output is byte-equivalent across engines during shadow soak.
const SKIP_TAGS: &[&str] = &[
    "html", "head", "meta", "title", "link", "script", "style", "noscript", "br", "hr",
];

#[derive(Debug, Clone)]
pub struct TaggedHtmlResult {
    pub tagged_html: String,
    pub tagged_count: u32,
}

/// Inject `data-op-id="<base36>"` on every addressable element. Counter is
/// monotonic across the document; an element that already carries an op-id
/// (from an upstream pipeline) keeps it. Empty/whitespace input passes
/// through unchanged with `tagged_count = 0`.
pub fn tag_with_op_ids(html: &str) -> Result<TaggedHtmlResult, EngineError> {
    if html.trim().is_empty() {
        return Ok(TaggedHtmlResult {
            tagged_html: html.to_string(),
            tagged_count: 0,
        });
    }

    let counter = Cell::new(0u32);

    let tagged = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("*", |el| {
                let tag = el.tag_name();
                if SKIP_TAGS.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
                    return Ok(());
                }
                if el.get_attribute(OP_ID_ATTR).is_some() {
                    return Ok(());
                }
                let id = base36(counter.get());
                counter.set(counter.get() + 1);
                el.set_attribute(OP_ID_ATTR, &id)
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| EngineError::Rewrite(e.to_string()))?;

    Ok(TaggedHtmlResult {
        tagged_html: tagged,
        tagged_count: counter.get(),
    })
}
