//! OpenLen image processing.
//!
//! Replaces the `sharp` Node binding with a Rust workspace crate that fits
//! the same napi-rs pattern as `@openlen/html-engine` / `@openlen/ai-gateway`
//! / `@openlen/rate-limit`.
//!
//! Public surface:
//!
//! - [`pipeline::process_image`] — the variant pipeline: one input buffer →
//!   N output variants in any combination of widths × formats. Decodes the
//!   input once, resizes once per unique target width, then encodes each
//!   (width, format) cell.
//! - [`resize::resize_lanczos3`] — Lanczos3 resize primitive used by the
//!   pipeline; exposed standalone for callers that want raw RGBA out.
//! - [`encoders`] — per-format encode functions.
//!
//! The napi binding in [`napi_binding`] re-exposes [`pipeline::process_image`]
//! as `processImage(req)`. The TS wrapper at `lib/images.ts` parses the
//! JSON error envelope back into a typed `OpenLenImageError` mirroring the
//! pattern used by [`@openlen/ai-gateway`].

pub mod encoders;
pub mod error;
pub mod exif;
pub mod pipeline;
pub mod placeholder;
pub mod resize;

pub mod napi_binding;

pub use error::ImageError;
pub use pipeline::{process_image, Format, ProcessRequest, ProcessResult, Variant, VariantOutput};
pub use placeholder::{compute_placeholder, Placeholder};
