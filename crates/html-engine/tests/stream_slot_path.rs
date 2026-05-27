// Slot-path detection across the streaming surface.
//
// The unit-tests in src/stream/slot_path.rs cover the scanner in
// isolation. These integration tests exercise the napi HtmlStream API
// and verify that the scanner is wired in fail-fast at write() and
// rechecked at end().

use openlen_html_engine::stream::{HtmlStream, JsHtmlStreamOpts};

fn s() -> HtmlStream {
    HtmlStream::new(Some(JsHtmlStreamOpts {
        inject_op_ids: Some(true),
        sanitize: Some(true),
        normalize_on_end: Some(false),
        minify_on_end: Some(false),
    }))
}

#[test]
fn literal_in_first_chunk_rejected_at_write() {
    let mut stream = s();
    let err = stream
        .write("<div data-slot-path=\"hero.title\">x</div>".into())
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("data-slot-path"),
        "expected slot-path error, got {}",
        err
    );
    assert!(err.contains("literal"), "expected literal label in {}", err);
}

#[test]
fn entity_encoded_first_char_rejected_at_write() {
    let mut stream = s();
    let err = stream
        .write("<div &#100;ata-slot-path=\"x\">y</div>".into())
        .unwrap_err()
        .to_string();
    assert!(err.contains("entity-encoded"), "got {}", err);
}

#[test]
fn mixed_case_rejected_at_write() {
    let mut stream = s();
    let err = stream
        .write("<div Data-Slot-Path=\"x\">y</div>".into())
        .unwrap_err()
        .to_string();
    assert!(err.contains("mixed-case"), "got {}", err);
}

#[test]
fn whitespace_around_equals_rejected_at_write() {
    let mut stream = s();
    let err = stream
        .write("<div data-slot-path =\"x\">y</div>".into())
        .unwrap_err()
        .to_string();
    assert!(err.contains("whitespace-around-equals"), "got {}", err);
}

#[test]
fn cross_chunk_boundary_literal_rejected_at_second_write() {
    let mut stream = s();
    // First half of marker — no `=` yet, no rejection.
    stream.write("<div data-sl".into()).unwrap();
    let err = stream
        .write("ot-path=\"x\">y</div>".into())
        .unwrap_err()
        .to_string();
    assert!(err.contains("data-slot-path"), "got {}", err);
}

#[test]
fn cross_chunk_entity_encoded_rejected() {
    let mut stream = s();
    stream.write("<div &#100;".into()).unwrap();
    let err = stream
        .write("ata-slot-path=\"x\">y</div>".into())
        .unwrap_err()
        .to_string();
    assert!(err.contains("entity-encoded"), "got {}", err);
}

#[test]
fn cross_chunk_whitespace_around_equals_rejected() {
    let mut stream = s();
    stream.write("<div data-slot-path".into()).unwrap();
    let err = stream
        .write(" =\"x\">y</div>".into())
        .unwrap_err()
        .to_string();
    assert!(err.contains("whitespace-around-equals"), "got {}", err);
}

#[test]
fn slot_path_in_text_content_rejected() {
    // The sync gate is zero-tolerance: slot-path occurrences in text
    // content fail too (per sanitize_adversarial_slot_path.rs). The
    // streaming gate inherits the same policy.
    let mut stream = s();
    let err = stream
        .write("<p>the reserved string data-slot-path= is here</p>".into())
        .unwrap_err()
        .to_string();
    assert!(err.contains("data-slot-path"), "got {}", err);
}

#[test]
fn slot_path_in_comment_rejected() {
    let mut stream = s();
    let err = stream
        .write("<!-- data-slot-path=foo --><p>x</p>".into())
        .unwrap_err()
        .to_string();
    assert!(err.contains("data-slot-path"), "got {}", err);
}

#[test]
fn slot_path_sticky_across_subsequent_writes() {
    let mut stream = s();
    let first = stream
        .write("<div data-slot-path=\"x\">y</div>".into())
        .unwrap_err()
        .to_string();
    // A second write must keep failing with the same detection — the
    // scanner is sticky once it has detected.
    let second = stream.write("more content".into()).unwrap_err().to_string();
    assert_eq!(first, second);
}

#[test]
fn slot_path_blocks_end_too() {
    let mut stream = s();
    stream
        .write("<div data-slot-path=\"x\">y</div>".into())
        .unwrap_err();
    // end() should also surface the sticky detection rather than
    // silently produce a (potentially leaked) document.
    let end_err = stream.end().unwrap_err().to_string();
    assert!(end_err.contains("data-slot-path"), "got {}", end_err);
}

#[test]
fn clean_streaming_does_not_trigger_false_positive() {
    let mut stream = s();
    // Plausible-looking but innocuous content; no `data-slot-path=`
    // anywhere.
    for c in [
        "<div data-other=\"x\">",
        "<p class=\"data-slot-foo\">",
        "<!-- comment about slot paths -->",
        "data-slot-path is a reserved marker in OpenLen.",
        "</p></div>",
    ] {
        stream.write(c.into()).unwrap();
    }
    let r = stream.end().unwrap();
    assert!(!r.final_html.is_empty());
}

#[test]
fn long_clean_input_does_not_balloon_scanner_state() {
    // Stream ~500 KB of clean HTML — scanner should keep working without
    // OOM. The rolling tail is bounded by design (TAIL_BYTES = 4 KiB).
    // Each chunk is <div>+4000x+</div> = 4011 bytes; 130 chunks ≈ 521 KB.
    let mut stream = s();
    let chunk = format!("<div>{}</div>", "x".repeat(4_000));
    for _ in 0..130 {
        stream.write(chunk.clone()).unwrap();
    }
    let r = stream.end().unwrap();
    assert!(
        r.bytes_in as usize >= 500_000,
        "expected ≥500 KB streamed, got {}",
        r.bytes_in
    );
}
