use crate::error::EngineError;
use lol_html::{rewrite_str, RewriteStrSettings};

pub fn round_trip(html: &str) -> Result<String, EngineError> {
    if html.is_empty() {
        return Ok(String::new());
    }
    rewrite_str(html, RewriteStrSettings::default())
        .map_err(|e| EngineError::Rewrite(e.to_string()))
}
