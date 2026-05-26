use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("lol-html rewrite failed: {0}")]
    Rewrite(String),

    #[error("input HTML rejected: contains reserved marker `data-slot-path=`")]
    SlotPathLeak,

    #[error("op apply: {0}")]
    OpApply(String),
}

impl From<EngineError> for napi::Error {
    fn from(e: EngineError) -> Self {
        napi::Error::from_reason(e.to_string())
    }
}
