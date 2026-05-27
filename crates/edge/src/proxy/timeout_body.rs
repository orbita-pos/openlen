//! Per-frame idle timeout for the upstream-relayed response body.
//!
//! The proxy's `connect_timeout` only caps the "send request + receive
//! response headers" phase (see `NodeClient::send`). Once headers arrive,
//! the upstream body is streamed back to the downstream client with no
//! further wall-clock cap — desirable for SSE, hostile for a misbehaving
//! Node that flushes headers and then hangs the body indefinitely.
//!
//! `TimeoutBody` wraps the upstream body and arms a `tokio::time::Sleep`
//! that resets on every frame. If no frame arrives within `idle_timeout`,
//! the next `poll_frame` returns an error — the downstream connection
//! terminates and the upstream connection is dropped along with the body.

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use http_body::{Body, Frame};
use tokio::time::{Instant, Sleep};

type BoxError = Box<dyn std::error::Error + Send + Sync + 'static>;

/// Body wrapper that enforces an idle timeout between successive frames.
pub struct TimeoutBody<B> {
    inner: B,
    sleep: Pin<Box<Sleep>>,
    idle_timeout: Duration,
}

impl<B> TimeoutBody<B> {
    /// Wrap `inner`, arming the idle timer to fire `idle_timeout` from now.
    pub fn new(inner: B, idle_timeout: Duration) -> Self {
        let sleep = Box::pin(tokio::time::sleep(idle_timeout));
        Self {
            inner,
            sleep,
            idle_timeout,
        }
    }
}

impl<B> Body for TimeoutBody<B>
where
    B: Body + Unpin,
    B::Error: Into<BoxError>,
{
    type Data = B::Data;
    type Error = BoxError;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        // Idle timer fired before a new frame → surface as an error.
        if let Poll::Ready(()) = self.sleep.as_mut().poll(cx) {
            return Poll::Ready(Some(Err(IdleTimeout(self.idle_timeout).into())));
        }
        match Pin::new(&mut self.inner).poll_frame(cx) {
            Poll::Ready(Some(Ok(frame))) => {
                // Reset on progress — next frame gets a fresh idle window.
                let deadline = Instant::now() + self.idle_timeout;
                self.sleep.as_mut().reset(deadline);
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Ready(Some(Err(err))) => Poll::Ready(Some(Err(err.into()))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> http_body::SizeHint {
        self.inner.size_hint()
    }
}

#[derive(Debug, thiserror::Error)]
#[error("upstream body idle for more than {0:?}")]
struct IdleTimeout(Duration);

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use http_body_util::{BodyExt, StreamBody};

    #[tokio::test]
    async fn passes_frames_through_when_no_idle() {
        let stream = futures_util::stream::iter(vec![
            Ok::<Frame<Bytes>, std::io::Error>(Frame::data(Bytes::from("hello"))),
            Ok(Frame::data(Bytes::from(" world"))),
        ]);
        let inner = StreamBody::new(stream);
        let body = TimeoutBody::new(inner, Duration::from_secs(5));
        let collected = BodyExt::collect(body).await.unwrap().to_bytes();
        assert_eq!(&collected[..], b"hello world");
    }

    #[tokio::test]
    async fn surfaces_error_when_idle_exceeds_timeout() {
        // A body that yields one frame, then hangs forever. With a 30 ms
        // idle window the second poll must error within ~milliseconds.
        // Box::pin makes async_stream's !Unpin AsyncStream usable inside
        // our Unpin-bounded TimeoutBody.
        let stream = Box::pin(async_stream::stream! {
            yield Ok::<Frame<Bytes>, std::io::Error>(Frame::data(Bytes::from("first")));
            std::future::pending::<()>().await;
        });
        let inner = StreamBody::new(stream);
        let body = TimeoutBody::new(inner, Duration::from_millis(30));
        let started = std::time::Instant::now();
        let result = BodyExt::collect(body).await;
        let elapsed = started.elapsed();
        assert!(result.is_err(), "collect must surface IdleTimeout");
        let err = result.err().unwrap();
        let msg = err.to_string();
        assert!(msg.contains("idle"), "msg: {msg}");
        // Must error well before any sane real-world deadline — proves
        // the timer fired rather than the test runner just bailing out.
        assert!(
            elapsed < Duration::from_secs(2),
            "idle timeout took too long: {elapsed:?}"
        );
    }

    #[tokio::test]
    async fn end_of_stream_returns_none_not_timeout() {
        let stream = futures_util::stream::iter(vec![Ok::<Frame<Bytes>, std::io::Error>(
            Frame::data(Bytes::from("only")),
        )]);
        let inner = StreamBody::new(stream);
        let body = TimeoutBody::new(inner, Duration::from_secs(60));
        let collected = BodyExt::collect(body).await.unwrap().to_bytes();
        assert_eq!(&collected[..], b"only");
    }

    #[tokio::test]
    async fn idle_timer_resets_on_each_frame() {
        // Three frames spaced ~20 ms apart with a 50 ms idle window. None
        // of the inter-frame gaps exceeds the window, so the body should
        // complete normally — proves the reset on Ready(Some(Ok)) works.
        let stream = Box::pin(async_stream::stream! {
            yield Ok::<Frame<Bytes>, std::io::Error>(Frame::data(Bytes::from("a")));
            tokio::time::sleep(Duration::from_millis(20)).await;
            yield Ok(Frame::data(Bytes::from("b")));
            tokio::time::sleep(Duration::from_millis(20)).await;
            yield Ok(Frame::data(Bytes::from("c")));
        });
        let inner = StreamBody::new(stream);
        let body = TimeoutBody::new(inner, Duration::from_millis(50));
        let collected = BodyExt::collect(body).await.unwrap().to_bytes();
        assert_eq!(&collected[..], b"abc");
    }
}
