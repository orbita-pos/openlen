// Byte-equal: streaming pipeline vs the composed sync pipeline.
//
// The sync chain we hold the streaming output against is:
//
//   final_sync = normalize(sanitize(tag(input)).html)
//
// (No minify by default; the streaming defaults match.) When the
// input is sanitize-clean (no scripts/iframes/etc. that get removed)
// AND every element is in SKIP_TAGS or survives sanitize, the
// streaming composite handler's tagging order matches `tag → sanitize`
// byte-for-byte.
//
// The 3 starter templates are the canonical clean-input corpus:
//   - counter.html, manuscript.html are sanitize-clean (no removals)
//   - mirror.html has the sparkline inline script; script is
//     SKIP_TAGS so the tagger never assigns it an op-id, and the
//     streaming pipeline strips it. Op-id sequence + final markup are
//     identical to the sync chain.

use std::fs;
use std::path::PathBuf;

use openlen_html_engine::normalize::normalize_born_canonical;
use openlen_html_engine::ops::tagger::tag_with_op_ids;
use openlen_html_engine::sanitize::sanitize_for_publish;
use openlen_html_engine::stream::run_stream;

fn starter(name: &str) -> String {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p.push(name);
    fs::read_to_string(p).expect("starter must be readable")
}

fn sync_pipeline(input: &str) -> String {
    let tagged = tag_with_op_ids(input)
        .expect("tag must succeed")
        .tagged_html;
    let sanitized = sanitize_for_publish(&tagged)
        .html
        .expect("starter is not slot-path-poisoned");
    normalize_born_canonical(&sanitized)
}

fn stream_default(chunks: &[&str]) -> String {
    run_stream(chunks, true, true, true, false)
        .unwrap()
        .final_html
}

fn split_into_n_chunks(s: &str, n: usize) -> Vec<String> {
    if n <= 1 || s.is_empty() {
        return vec![s.to_string()];
    }
    let target = s.len() / n;
    let mut out = Vec::with_capacity(n);
    let mut i = 0;
    while i < s.len() {
        let goal = (i + target).min(s.len());
        // Snap forward to a UTF-8 char boundary so the chunks remain
        // valid &str.
        let end = (goal..=s.len()).find(|&j| s.is_char_boundary(j)).unwrap();
        out.push(s[i..end].to_string());
        i = end;
    }
    out
}

#[test]
fn counter_starter_byte_equal_single_chunk() {
    let src = starter("counter.html");
    let sync = sync_pipeline(&src);
    let stream = stream_default(&[src.as_str()]);
    assert_eq!(sync, stream, "counter.html single-chunk must be byte-equal");
}

#[test]
fn manuscript_starter_byte_equal_single_chunk() {
    let src = starter("manuscript.html");
    let sync = sync_pipeline(&src);
    let stream = stream_default(&[src.as_str()]);
    assert_eq!(
        sync, stream,
        "manuscript.html single-chunk must be byte-equal"
    );
}

#[test]
fn mirror_starter_byte_equal_single_chunk() {
    let src = starter("mirror.html");
    let sync = sync_pipeline(&src);
    let stream = stream_default(&[src.as_str()]);
    assert_eq!(sync, stream, "mirror.html single-chunk must be byte-equal");
}

#[test]
fn counter_byte_equal_under_64_chunks() {
    let src = starter("counter.html");
    let sync = sync_pipeline(&src);
    let chunks = split_into_n_chunks(&src, 64);
    let chunk_refs: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
    let stream = stream_default(&chunk_refs);
    assert_eq!(
        sync, stream,
        "counter.html chunked output must be byte-equal"
    );
}

#[test]
fn manuscript_byte_equal_under_64_chunks() {
    let src = starter("manuscript.html");
    let sync = sync_pipeline(&src);
    let chunks = split_into_n_chunks(&src, 64);
    let chunk_refs: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
    let stream = stream_default(&chunk_refs);
    assert_eq!(sync, stream);
}

#[test]
fn mirror_byte_equal_under_64_chunks() {
    let src = starter("mirror.html");
    let sync = sync_pipeline(&src);
    let chunks = split_into_n_chunks(&src, 64);
    let chunk_refs: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
    let stream = stream_default(&chunk_refs);
    assert_eq!(sync, stream);
}

#[test]
fn mirror_inline_sparkline_script_stripped_in_streaming() {
    let src = starter("mirror.html");
    let r = run_stream(&[src.as_str()], true, true, true, false).unwrap();
    // The sparkline `<script>` body (inline, no allowed src) is gone.
    // The Tailwind CDN `<script src="https://cdn.tailwindcss.com">` survives.
    assert!(r.sanitize_removed.scripts >= 1);
    assert!(r.final_html.contains("cdn.tailwindcss.com"));
}

#[test]
fn starters_op_ids_match_sync_for_each_chunk_size() {
    // For each starter, run streaming with N=1, 8, 64 chunks and assert
    // op_ids_assigned matches the sync pipeline's tagger count.
    for starter_name in ["counter.html", "manuscript.html", "mirror.html"] {
        let src = starter(starter_name);
        let sync_tagged = tag_with_op_ids(&src).expect("tag").tagged_count;
        for n in [1usize, 8, 64] {
            let chunks = split_into_n_chunks(&src, n);
            let chunk_refs: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
            let r = run_stream(&chunk_refs, true, true, true, false).unwrap();
            assert_eq!(
                r.op_ids_assigned, sync_tagged,
                "{} (n={}): streamed op-ids {} != sync tagger count {}",
                starter_name, n, r.op_ids_assigned, sync_tagged
            );
        }
    }
}
