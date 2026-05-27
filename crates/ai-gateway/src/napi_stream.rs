//! Async stream bridge for the napi binding.
//!
//! Exposes a `GeminiStream` napi class that wraps the Rust
//! [`futures::stream::BoxStream`] returned by
//! [`crate::GeminiProvider::stream`]. The class supports two operations:
//!
//! - `await stream.next()` — pulls the next [`crate::types::StreamEvent`],
//!   returning `null` (JS) when the stream is exhausted.
//! - `stream.cancel()` — signals the inner
//!   [`tokio_util::sync::CancellationToken`] so the upstream socket
//!   terminates within ~5 ms.
//!
//! The TS wrapper at `lib/ai-gateway.ts` layers a `Symbol.asyncIterator`
//! on top so JS callers get the idiomatic `for await (const ev of stream)`
//! shape and an `AbortSignal` → `cancel()` bridge.
//!
//! ## Cancellation contract
//!
//! Cancel arrives in one of three windows. All three end in exactly one
//! terminal `Done { stopReason: 'cancelled' }` event before the iterator
//! returns `null`:
//!
//! 1. **Before `next()` is ever awaited** — `cancel()` fires the token,
//!    then the first `next()` finds the token already cancelled. The
//!    underlying provider returns `GatewayError::Cancelled` from its
//!    initial POST (biased `select!` arm). This binding synthesises a
//!    `Done { Cancelled }` event so JS callers see the same terminal
//!    shape as case 3 — no try/catch needed for clean cancellation.
//! 2. **During the initial POST** — same path as case 1: provider's
//!    biased `select!` short-circuits the POST future and returns
//!    `GatewayError::Cancelled`; this binding synthesises the terminal
//!    `Done`.
//! 3. **Mid-stream** — the underlying `BoxStream`'s biased `select!`
//!    catches the cancel and yields a real `Done { Cancelled }` event
//!    before terminating. No synthesis needed.
//!
//! ## Lock discipline
//!
//! The inner state is held in a [`tokio::sync::Mutex`] so the lock can
//! be released across awaits. The decision-block at the top of `next()`
//! is synchronous; it moves the heavy work (the initial POST or the
//! frame poll) into an [`Action`] enum that's processed *outside* the
//! lock. This keeps `cancel()` (which doesn't lock at all — it only
//! signals the token) responsive even when a `next()` is in flight.

use std::sync::Arc;

use futures::stream::{BoxStream, StreamExt};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use tokio::sync::Mutex as TokioMutex;
use tokio_util::sync::CancellationToken;

use crate::error::GatewayError;
use crate::napi::{gateway_error_to_napi, GeminiProvider, StreamEvent, StreamRequest};
use crate::types::{
    StopReason as NativeStopReason, StreamEvent as NativeStreamEvent,
    StreamRequest as NativeStreamRequest,
};

#[napi]
impl GeminiProvider {
    /// Open a streaming generation. **Synchronous** — returns immediately
    /// with a `GeminiStream` whose upstream POST hasn't started yet. The
    /// POST fires lazily on the first `next()` call. That lets JS callers
    /// attach an AbortSignal listener (or run any other setup) BEFORE the
    /// network call begins, so `cancel()` can short-circuit even the
    /// pre-flight phase.
    ///
    /// The returned stream is single-consumer; concurrent `next()` calls
    /// will serialise on the internal mutex. `cancel()` doesn't take the
    /// mutex and is safe to call concurrently with `next()`.
    #[napi]
    pub fn stream(&self, request: StreamRequest) -> Result<GeminiStream> {
        let native: NativeStreamRequest = request.try_into()?;
        Ok(GeminiStream::new(self.inner.clone(), native))
    }
}

/// JS-facing async iterator over Gemini stream events. Construct via
/// `GeminiProvider#stream(request)`.
#[napi]
pub struct GeminiStream {
    state: Arc<TokioMutex<StreamState>>,
    cancel: CancellationToken,
}

enum StreamState {
    /// Pre-POST: parameters captured, network not yet hit.
    Initial {
        provider: crate::GeminiProvider,
        request: NativeStreamRequest,
    },
    /// POST returned 200; pulling SSE frames.
    Open(BoxStream<'static, std::result::Result<NativeStreamEvent, GatewayError>>),
    /// Pre-start cancel happened; the next call yields a synthetic
    /// `Done { Cancelled }` before moving to `Closed`. This exists so
    /// JS callers see exactly one terminal `done` event regardless of
    /// when cancellation arrived.
    PendingSyntheticDone,
    /// Stream exhausted, errored, or fully drained after a terminal
    /// event. All further `next()` calls return `Ok(None)`.
    Closed,
}

enum Action {
    OpenStream {
        provider: crate::GeminiProvider,
        request: NativeStreamRequest,
    },
    PullNext {
        stream: BoxStream<'static, std::result::Result<NativeStreamEvent, GatewayError>>,
    },
}

impl GeminiStream {
    fn new(provider: crate::GeminiProvider, request: NativeStreamRequest) -> Self {
        Self {
            state: Arc::new(TokioMutex::new(StreamState::Initial { provider, request })),
            cancel: CancellationToken::new(),
        }
    }
}

#[napi]
impl GeminiStream {
    /// Pull the next [`crate::types::StreamEvent`]. Resolves to `null` (JS)
    /// when the stream is exhausted; throws a `GatewayError`-envelope
    /// `Error` on stream-level failures (network drop mid-flight,
    /// malformed SSE, etc.).
    ///
    /// Safe to call repeatedly after the iterator has ended — additional
    /// calls return `null` synchronously without re-hitting the network.
    #[napi]
    pub async fn next(&self) -> Result<Option<StreamEvent>> {
        loop {
            // Decision phase: hold the lock just long enough to extract
            // an Action describing the heavy work. Cancel can race with
            // this — that's fine, since the underlying tokio_select
            // checks the token before any I/O on the way in.
            let action = {
                let mut guard = self.state.lock().await;
                match std::mem::replace(&mut *guard, StreamState::Closed) {
                    StreamState::Initial { provider, request } => {
                        Action::OpenStream { provider, request }
                    }
                    StreamState::Open(stream) => Action::PullNext { stream },
                    StreamState::PendingSyntheticDone => {
                        // state stays Closed; emit the terminal event.
                        return Ok(Some(StreamEvent::from(NativeStreamEvent::Done {
                            stop_reason: NativeStopReason::Cancelled,
                        })));
                    }
                    StreamState::Closed => return Ok(None),
                }
            };

            match action {
                Action::OpenStream { provider, request } => {
                    let stream_result = provider.stream(request, self.cancel.clone()).await;
                    let mut guard = self.state.lock().await;
                    match stream_result {
                        Ok(stream) => {
                            *guard = StreamState::Open(stream);
                            // Loop again to pull the first frame.
                            continue;
                        }
                        Err(GatewayError::Cancelled) => {
                            // Stash the synthetic Done; next iteration emits it.
                            *guard = StreamState::PendingSyntheticDone;
                            continue;
                        }
                        Err(other) => {
                            // *guard already Closed (from the mem::replace above).
                            return Err(gateway_error_to_napi(other));
                        }
                    }
                }
                Action::PullNext { mut stream } => {
                    let pulled = stream.next().await;
                    let mut guard = self.state.lock().await;
                    match pulled {
                        None => {
                            // *guard already Closed.
                            return Ok(None);
                        }
                        Some(Ok(event)) => {
                            *guard = StreamState::Open(stream);
                            return Ok(Some(event.into()));
                        }
                        Some(Err(err)) => {
                            // *guard already Closed.
                            return Err(gateway_error_to_napi(err));
                        }
                    }
                }
            }
        }
    }

    /// Cancel the upstream socket. Idempotent and synchronous — fires
    /// the inner [`tokio_util::sync::CancellationToken`], which all
    /// `select!` arms in the underlying provider observe with a
    /// `biased` priority. Mid-stream cancel typically completes in
    /// well under 5 ms; the documented SLA is < 500 ms.
    ///
    /// Safe to call from any JS context, including concurrently with
    /// `next()`. Does not take the internal mutex.
    #[napi]
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
}
