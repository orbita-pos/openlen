//! OpenLen AI streaming gateway.
//!
//! Single-provider crate built around Google Gemini. The public surface is a
//! concrete `GeminiProvider` — no `Provider` trait, no `dyn`. Callers receive
//! a [`futures::stream::BoxStream`] of stream events and can cancel the
//! upstream call mid-flight by signalling a
//! [`tokio_util::sync::CancellationToken`] (or simply dropping the stream).
//!
//! Two surfaces:
//!
//! - **Native Rust API** (`gemini::GeminiProvider`, `tokenizer::estimate_tokens`)
//!   — used by other crates in this workspace and by Rust integration tests.
//!   Stable since F3 S1.
//! - **napi binding** (`napi::*`, `napi_stream::*`) — exposes the same surface
//!   to Node via napi-rs. Added in F3 S2. The binding is additive: every
//!   item in those modules has a JS counterpart, and the native Rust API is
//!   untouched.
//!
//! Out of scope:
//!
//! - HtmlStream integration — F3 S3.
//! - `lib/credits.ts` hook-up + `/api/generate` cutover — F3 S3-S4.

pub mod error;
pub mod gemini;
pub mod tokenizer;
pub mod types;

pub mod napi;
pub mod napi_stream;

pub use error::GatewayError;
pub use gemini::GeminiProvider;
pub use tokenizer::estimate_tokens;
pub use types::{InlineImage, Message, Role, StopReason, StreamEvent, StreamRequest, Usage};
