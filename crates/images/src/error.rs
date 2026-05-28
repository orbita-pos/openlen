use thiserror::Error;

#[derive(Debug, Error)]
pub enum ImageError {
    #[error("decode failed: {0}")]
    Decode(String),

    #[error("encode failed ({format}): {message}")]
    Encode { format: &'static str, message: String },

    #[error("resize failed: {0}")]
    Resize(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),
}

impl ImageError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Decode(_) => "decode",
            Self::Encode { .. } => "encode",
            Self::Resize(_) => "resize",
            Self::InvalidInput(_) => "invalid_input",
        }
    }

    pub fn is_retryable(&self) -> bool {
        // None of these errors are retryable — bad bytes stay bad.
        false
    }
}
