//! OpenLen AI streaming gateway.
//!
//! Single-provider crate built around Google Gemini. The public surface is a
//! concrete `GeminiProvider` — no `Provider` trait, no `dyn`. Callers receive
//! a [`futures::stream::BoxStream`] of stream events and can cancel the
//! upstream call mid-flight by signalling a
//! [`tokio_util::sync::CancellationToken`] (or simply dropping the stream).
//!
//! Scope today (F3 S1):
//!
//! - `gemini::GeminiProvider` — REST/SSE streaming against
//!   `generativelanguage.googleapis.com`, no napi binding yet.
//! - `tokenizer::estimate_tokens` — chars/4 heuristic for pre-flight credit
//!   checks. Exact counts come from `StreamEvent::Usage` events emitted by
//!   the provider.
//!
//! Out of scope:
//!
//! - napi-rs binding to Node — F3 S2.
//! - HtmlStream integration — F3 S3.
//! - `lib/credits.ts` hook-up + `/api/generate` cutover — F3 S3-S4.

pub mod error;
pub mod gemini;
pub mod tokenizer;
pub mod types;

pub use error::GatewayError;
pub use tokenizer::estimate_tokens;
pub use types::{Message, Role, StopReason, StreamEvent, StreamRequest, Usage};
