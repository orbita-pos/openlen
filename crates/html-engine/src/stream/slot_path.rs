// Streaming slot-path detection.
//
// `sanitize::slot_path::detect_slot_path` works on a complete document
// — it scans the entire byte stream once for the literal marker, then
// (if needed) entity-decodes and rescans. The streaming pipeline can't
// wait for the full document; we have to detect a marker that may span
// chunk boundaries, e.g. `data-sl` arrives in chunk 5 and `ot-path=`
// arrives in chunk 6.
//
// Strategy: keep the last `TAIL_BYTES` of accumulated input around as
// a rolling tail. On each new chunk, scan `tail + chunk` via the
// existing sync detector — this catches markers that straddle the
// previous chunk's end and the current chunk's start. After scanning,
// trim the tail to its last `TAIL_BYTES` (at a UTF-8 char boundary so
// the subsequent scan stays valid).
//
// `TAIL_BYTES` must exceed the longest sequence that can spell out
// `data-slot-path=` after every variant our detector accepts:
//   - 14 byte literal (`data-slot-path`)
//   - 70-ish bytes when every letter is `&#NNN;`-encoded
//   - up to ~90 bytes for `&#xHHH;` hex form
//   - plus 1 for the `=`, optional ASCII whitespace around `=`
//   - plus arbitrary leading-zero padding in numeric entities; the
//     sync detector defends against `&#000…00100;` by accepting any
//     digit run.
//
// 4096 bytes is far more than necessary for any realistic marker and
// still bounded — even 1 GiB of streamed input keeps the rolling tail
// at 4 KiB.
//
// Once a marker is detected the scanner becomes sticky: subsequent
// `feed` calls return the same detection without rescanning. F3's
// gateway can treat the first error from `feed` as "abort this chunk
// and report the failure" without worrying about a later feed
// silently passing.

use crate::sanitize::slot_path::{detect_slot_path, SlotPathDetection};

const TAIL_BYTES: usize = 4096;

pub struct StreamingSlotPathScanner {
    /// Up to `TAIL_BYTES` of recent input retained across `feed` calls so
    /// markers spanning chunk boundaries are caught.
    tail: String,
    /// Total bytes ever fed (informational; useful for the position
    /// offset reported in error messages once we surface byte offsets).
    bytes_fed: usize,
    /// Sticky: once a marker is detected, future feeds short-circuit
    /// to the same error.
    detected: Option<SlotPathDetection>,
}

impl StreamingSlotPathScanner {
    pub fn new() -> Self {
        Self {
            tail: String::new(),
            bytes_fed: 0,
            detected: None,
        }
    }

    pub fn bytes_fed(&self) -> usize {
        self.bytes_fed
    }

    /// Feed a chunk of text. Returns `Err(detection)` the moment the
    /// rolling buffer contains the slot-path marker. Once an error is
    /// returned, subsequent calls keep returning it (no rescans).
    pub fn feed(&mut self, chunk: &str) -> Result<(), SlotPathDetection> {
        if let Some(d) = self.detected.as_ref() {
            return Err(d.clone());
        }

        // Build scan = tail + chunk. The capacity hint avoids the
        // doubling realloc when `tail` is at TAIL_BYTES + chunk is large.
        let mut scan = String::with_capacity(self.tail.len() + chunk.len());
        scan.push_str(&self.tail);
        scan.push_str(chunk);

        if let Some(hit) = detect_slot_path(&scan) {
            self.detected = Some(hit.clone());
            return Err(hit);
        }

        // Trim tail to the last TAIL_BYTES bytes, snapping forward to
        // the next UTF-8 char boundary so the next scan starts on a
        // valid char and `&str` operations stay safe.
        if scan.len() > TAIL_BYTES {
            let target_start = scan.len() - TAIL_BYTES;
            let safe_start = (target_start..=scan.len())
                .find(|&i| scan.is_char_boundary(i))
                .unwrap_or(scan.len());
            // drain the prefix before safe_start
            scan.drain(0..safe_start);
        }
        self.tail = scan;
        self.bytes_fed += chunk.len();
        Ok(())
    }

    /// Final check at stream end. The rolling-buffer scan already runs
    /// at every feed, so this is a no-op for the sticky-detected case
    /// — it exists so callers can chain `feed`/`finalize` symmetrically.
    pub fn finalize(&self) -> Result<(), SlotPathDetection> {
        if let Some(d) = self.detected.as_ref() {
            return Err(d.clone());
        }
        Ok(())
    }
}

impl Default for StreamingSlotPathScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sanitize::slot_path::SlotPathPosition;

    #[test]
    fn clean_input_passes_through() {
        let mut s = StreamingSlotPathScanner::new();
        for chunk in ["<div>", "<p>hello</p>", "</div>"] {
            assert!(s.feed(chunk).is_ok());
        }
        assert!(s.finalize().is_ok());
        assert_eq!(s.bytes_fed(), "<div><p>hello</p></div>".len());
    }

    #[test]
    fn literal_in_single_chunk_caught() {
        let mut s = StreamingSlotPathScanner::new();
        let err = s
            .feed("<div data-slot-path=\"hero.title\">x</div>")
            .unwrap_err();
        assert_eq!(err.position, SlotPathPosition::Literal);
    }

    #[test]
    fn literal_spanning_two_chunks_caught() {
        // Marker split across two writes: `data-sl` ends chunk 1,
        // `ot-path=` starts chunk 2. detect_slot_path on tail+chunk2
        // sees the full marker.
        let mut s = StreamingSlotPathScanner::new();
        assert!(s.feed("<div data-sl").is_ok());
        let err = s.feed("ot-path=\"x\">y</div>").unwrap_err();
        assert_eq!(err.position, SlotPathPosition::Literal);
    }

    #[test]
    fn mixed_case_spanning_chunks_caught() {
        let mut s = StreamingSlotPathScanner::new();
        assert!(s.feed("<div Data-Sl").is_ok());
        let err = s.feed("ot-Path=\"x\">y</div>").unwrap_err();
        assert_eq!(err.position, SlotPathPosition::MixedCase);
    }

    #[test]
    fn whitespace_around_equals_spanning_chunks_caught() {
        let mut s = StreamingSlotPathScanner::new();
        assert!(s.feed("<div data-slot-path").is_ok());
        let err = s.feed(" =\"x\">y</div>").unwrap_err();
        assert_eq!(err.position, SlotPathPosition::WhitespaceAroundEquals);
    }

    #[test]
    fn entity_encoded_spanning_chunks_caught() {
        // First char comes via numeric entity in chunk 1, the rest
        // arrives in chunk 2. Rolling-buffer scan + entity decode
        // catches it.
        let mut s = StreamingSlotPathScanner::new();
        assert!(s.feed("<div &#100;").is_ok());
        let err = s.feed("ata-slot-path=\"x\">y</div>").unwrap_err();
        assert_eq!(err.position, SlotPathPosition::EntityEncoded);
    }

    #[test]
    fn entity_byte_byte_spanning_many_chunks_caught() {
        // Pathological: every character split into its own chunk.
        let mut s = StreamingSlotPathScanner::new();
        let payload = "&#100;ata-slot-path=";
        for ch in payload.chars() {
            // We may detect mid-stream; once we do, the test passes.
            if s.feed(&ch.to_string()).is_err() {
                return;
            }
        }
        // If we got here without detection, finalize() should not flag
        // (the marker landed atomically). Sanity-check the whole input
        // was seen: bytes_fed must equal payload bytes.
        assert_eq!(s.bytes_fed(), payload.len());
        // Then one more feed of nothing pushes the rolling buffer past
        // the marker — already detected in the loop. If we reach here
        // without detection, the input wasn't a marker anyway, which
        // is a regression we want to surface.
        panic!("expected detection during chunk-by-chunk feed");
    }

    #[test]
    fn sticky_detection_short_circuits() {
        let mut s = StreamingSlotPathScanner::new();
        // First chunk already contains the marker.
        let first = s.feed("<div data-slot-path=\"x\">").unwrap_err();
        // Subsequent feeds must return the same detection without
        // doing any work; the position field is the cheapest equality.
        let second = s.feed("anything").unwrap_err();
        assert_eq!(first.position, second.position);
        let third = s.finalize().unwrap_err();
        assert_eq!(first.position, third.position);
    }

    #[test]
    fn rolling_buffer_does_not_explode_on_long_clean_input() {
        // 100 chunks × 8 KB clean HTML each = 800 KB total fed.
        // Rolling tail must stay bounded near TAIL_BYTES (4 KiB).
        let mut s = StreamingSlotPathScanner::new();
        let chunk = "<div>".to_string() + &"x".repeat(8_000) + "</div>";
        for _ in 0..100 {
            s.feed(&chunk).unwrap();
        }
        // bytes_fed reflects everything written, but the internal tail
        // should not — the field's not exposed, so this test is the
        // closest invariant we can assert from outside: the scanner
        // didn't OOM and accepted all input.
        assert_eq!(s.bytes_fed(), chunk.len() * 100);
    }

    #[test]
    fn after_detection_finalize_still_errors() {
        let mut s = StreamingSlotPathScanner::new();
        s.feed("data-slot-path=foo").unwrap_err();
        assert!(s.finalize().is_err());
    }

    #[test]
    fn empty_chunks_do_not_break_scanner() {
        let mut s = StreamingSlotPathScanner::new();
        for _ in 0..5 {
            s.feed("").unwrap();
        }
        assert!(s.feed("<div>ok</div>").is_ok());
        assert!(s.finalize().is_ok());
    }
}
