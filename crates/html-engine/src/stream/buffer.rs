// Shared output buffers for the streaming pipeline.
//
// The streaming HTML pipeline emits two parallel views of the rewritten
// bytes:
//
//   1. The *chunk* buffer holds only the bytes lol-html produced during
//      the most recent `write()` call. The caller clears it before each
//      write so its content is the per-write output handed back to JS.
//   2. The *full* buffer accumulates every byte across the lifetime of
//      the stream. `end()` applies the post-stream transforms
//      (normalize, optionally minify) over the full buffer.
//
// Both share the same lol-html `OutputSink` closure — the rewriter never
// knows there are two consumers. The closure captures `Rc` clones so it
// is `'static` and can live inside the rewriter's settings without
// borrowing the surrounding `HtmlStream` struct.
//
// `Rc<RefCell<…>>` (single-threaded interior mutability) is intentional:
// napi-rs class methods run on the JS thread synchronously, so a `Send`
// requirement never fires. If F3's gateway ever needs to share an
// `HtmlStream` across threads, swap `Rc`→`Arc` and `RefCell`→`Mutex`.

use std::cell::RefCell;
use std::rc::Rc;

/// Type alias for the lol-html OutputSink the streaming pipeline uses.
/// Boxed because lol-html's `HtmlRewriter<'h, O: OutputSink>` requires a
/// concrete `O` and we want to store the rewriter in a struct field.
pub type SinkFn = Box<dyn FnMut(&[u8]) + 'static>;

#[derive(Clone)]
pub struct StreamBuffers {
    pub chunk: Rc<RefCell<Vec<u8>>>,
    pub full: Rc<RefCell<Vec<u8>>>,
}

impl StreamBuffers {
    pub fn new() -> Self {
        Self {
            chunk: Rc::new(RefCell::new(Vec::new())),
            full: Rc::new(RefCell::new(Vec::new())),
        }
    }

    /// Returns a `'static` sink closure suitable for lol-html's
    /// `OutputSink` blanket impl on `FnMut(&[u8])`. Each byte the
    /// rewriter emits is appended to both the per-chunk and the full
    /// buffer.
    pub fn sink(&self) -> SinkFn {
        let chunk = Rc::clone(&self.chunk);
        let full = Rc::clone(&self.full);
        Box::new(move |b: &[u8]| {
            chunk.borrow_mut().extend_from_slice(b);
            full.borrow_mut().extend_from_slice(b);
        })
    }

    pub fn clear_chunk(&self) {
        self.chunk.borrow_mut().clear();
    }

    /// Drain the per-chunk buffer to a UTF-8 string. lol-html guarantees
    /// the byte stream stays UTF-8-valid when fed UTF-8 input (chunks
    /// come from JS strings — already UTF-8), so the `from_utf8_lossy`
    /// fallback should never trigger; it's a defense against catastrophic
    /// internal corruption rather than expected behavior.
    pub fn take_chunk_string(&self) -> String {
        let bytes = self.chunk.borrow().clone();
        match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
        }
    }

    pub fn full_len(&self) -> usize {
        self.full.borrow().len()
    }

    pub fn full_as_string(&self) -> String {
        let bytes = self.full.borrow().clone();
        match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
        }
    }
}

impl Default for StreamBuffers {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sink_appends_to_both_buffers() {
        let buf = StreamBuffers::new();
        let mut sink = buf.sink();
        sink(b"hello");
        sink(b" world");
        assert_eq!(buf.take_chunk_string(), "hello world");
        assert_eq!(buf.full_as_string(), "hello world");
        assert_eq!(buf.full_len(), 11);
    }

    #[test]
    fn clear_chunk_leaves_full_intact() {
        let buf = StreamBuffers::new();
        let mut sink = buf.sink();
        sink(b"first");
        buf.clear_chunk();
        sink(b"second");
        assert_eq!(buf.take_chunk_string(), "second");
        assert_eq!(buf.full_as_string(), "firstsecond");
    }

    #[test]
    fn empty_take_is_empty() {
        let buf = StreamBuffers::new();
        assert_eq!(buf.take_chunk_string(), "");
        assert_eq!(buf.full_as_string(), "");
    }

    #[test]
    fn clone_shares_state() {
        // Rc clones share the same allocation, so a sink derived from
        // either clone writes to the same Vec.
        let buf = StreamBuffers::new();
        let mirror = buf.clone();
        let mut sink = buf.sink();
        sink(b"abc");
        assert_eq!(mirror.full_as_string(), "abc");
    }
}
