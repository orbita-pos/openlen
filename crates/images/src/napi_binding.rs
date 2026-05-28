//! napi-rs binding for `openlen-images`.
//!
//! Exposes a single async function: `processImage(req)`. The request
//! shape is camelCased by napi-derive (so JS sees `autoOrient`,
//! `withoutEnlargement`), the response is a `{ variants: [...] }` envelope
//! with Buffer payloads.
//!
//! Heavy CPU work runs in `tokio::task::spawn_blocking` so the libuv
//! thread that delivers the napi callback never stalls on a 5 MB AVIF
//! encode — the same pattern as a `worker_thread` pool, but managed by
//! tokio. Net effect on the Next.js request handler is identical to what
//! sharp does: the JS thread can keep serving other requests while the
//! native code crunches.

use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::error::ImageError;
use crate::pipeline::{self, Format as NativeFormat};

#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsVariant {
    /// Target max width in pixels. Pass 0 to use the input's intrinsic
    /// width (skip resize). Aspect ratio is always preserved.
    pub width: u32,
    /// Optional companion bound on the height. When present, the variant
    /// is scaled by the SMALLER of the width and the height bound —
    /// sharp's `{ width, height, fit: 'inside' }` semantics. Omit to
    /// leave the height unbounded.
    pub max_height: Option<u32>,
    /// One of: `"webp"`, `"avif"`, `"jpeg"` (alias: `"jpg"`), `"png"`.
    /// Case-insensitive.
    pub format: String,
    /// Encoder quality 1..=100. Ignored for PNG (lossless).
    pub quality: u32,
}

#[napi(object)]
#[derive(Clone)]
pub struct ProcessRequestJs {
    pub input: Buffer,
    pub variants: Vec<JsVariant>,
    /// Read EXIF orientation and rotate before resizing. Default: `true`.
    pub auto_orient: Option<bool>,
    /// Clamp a variant's target width to the input's intrinsic width.
    /// Default: `true` (sharp's `withoutEnlargement` default).
    pub without_enlargement: Option<bool>,
}

#[napi(object)]
#[derive(Clone)]
pub struct VariantOutputJs {
    pub width: u32,
    pub height: u32,
    /// Lowercase format string, matching `JsVariant.format`.
    pub format: String,
    /// IANA media type — useful when uploading directly to a storage
    /// adapter that wants the Content-Type set.
    pub mime: String,
    pub bytes: Buffer,
    /// Convenience copy of `bytes.length` (saves a property hop in tight
    /// loops on the JS side).
    pub size: u32,
}

#[napi(object)]
#[derive(Clone)]
pub struct ProcessResultJs {
    pub variants: Vec<VariantOutputJs>,
}

fn envelope(kind: &str, retryable: bool, message: impl Into<String>) -> String {
    serde_json::json!({
        "kind": kind,
        "retryable": retryable,
        "message": message.into(),
    })
    .to_string()
}

fn image_error_to_napi(err: ImageError) -> napi::Error {
    napi::Error::from_reason(envelope(err.kind(), err.is_retryable(), err.to_string()))
}

fn invalid_format(format: &str) -> napi::Error {
    napi::Error::from_reason(envelope(
        "invalid_input",
        false,
        format!(
            "invalid format \"{}\" (expected: webp, avif, jpeg, png)",
            format
        ),
    ))
}

/// Process an image into one or more output variants.
///
/// JS shape:
/// ```js
/// const result = await processImage({
///   input: Buffer,
///   variants: [{ width, format, quality }, ...],
///   autoOrient?: boolean,        // default true
///   withoutEnlargement?: boolean // default true
/// })
/// // result.variants: [{ width, height, format, mime, bytes, size }, ...]
/// ```
#[napi]
pub async fn process_image(req: ProcessRequestJs) -> Result<ProcessResultJs> {
    let input: Vec<u8> = req.input.into();

    let variants = req
        .variants
        .into_iter()
        .map(|v| {
            let fmt = NativeFormat::parse(&v.format).ok_or_else(|| invalid_format(&v.format))?;
            Ok(pipeline::Variant {
                width: v.width,
                max_height: v.max_height,
                format: fmt,
                quality: v.quality.min(100) as u8,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let native_req = pipeline::ProcessRequest {
        input,
        variants,
        auto_orient: req.auto_orient.unwrap_or(true),
        without_enlargement: req.without_enlargement.unwrap_or(true),
        // Phase E wires the JS-side `placeholder` flag through. Until
        // then the napi entry always passes false — existing JS callers
        // never knew the flag existed, so they're unaffected.
        placeholder: false,
    };

    let result = tokio::task::spawn_blocking(move || pipeline::process_image(native_req))
        .await
        .map_err(|e| napi::Error::from_reason(format!("join error: {e}")))?
        .map_err(image_error_to_napi)?;

    let variants_js: Vec<VariantOutputJs> = result
        .variants
        .into_iter()
        .map(|v| {
            let size = v.bytes.len() as u32;
            VariantOutputJs {
                width: v.width,
                height: v.height,
                format: v.format.as_str().to_owned(),
                mime: v.format.mime().to_owned(),
                bytes: Buffer::from(v.bytes),
                size,
            }
        })
        .collect();

    Ok(ProcessResultJs {
        variants: variants_js,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_shape_matches_other_crates() {
        let env = envelope("decode", false, "bad bytes");
        let parsed: serde_json::Value = serde_json::from_str(&env).unwrap();
        assert_eq!(parsed["kind"], "decode");
        assert_eq!(parsed["retryable"], false);
        assert_eq!(parsed["message"], "bad bytes");
    }

    #[test]
    fn invalid_format_envelope_carries_offending_string() {
        let err = invalid_format("bmp");
        let parsed: serde_json::Value = serde_json::from_str(&err.reason).unwrap();
        assert_eq!(parsed["kind"], "invalid_input");
        assert!(parsed["message"].as_str().unwrap().contains("bmp"));
    }

    #[test]
    fn image_error_to_napi_preserves_kind() {
        let err = image_error_to_napi(ImageError::InvalidInput("nope".into()));
        let parsed: serde_json::Value = serde_json::from_str(&err.reason).unwrap();
        assert_eq!(parsed["kind"], "invalid_input");
        assert_eq!(parsed["retryable"], false);
    }
}
