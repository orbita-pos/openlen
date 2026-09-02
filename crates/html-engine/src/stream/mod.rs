// Streaming HTML pipeline for F3's AI Gateway.
//
// `HtmlStream` is a #[napi] class that accepts HTML in chunks (typically
// SSE deltas from a Gemini / Kimi response) and emits chunks back that
// are already tag + sanitize transformed, so the editor can render a
// live preview without waiting for the full document. At end() the
// full accumulated document is passed through `normalize_born_canonical`
// and — optionally — `optimize_for_publish` for the final HTML.
//
// Pipeline shape (Option A in the session brief):
//
//   ┌──────────┐    ┌──────────┐    ┌────────────────────────────┐
//   │ JS chunk ├───►│ slot_path├───►│ composite lol-html rewriter│
//   └──────────┘    │  scanner │    │   (tag + sanitize)         │
//                   └──────────┘    └────────────────┬───────────┘
//                       │ fail-fast on detection      │
//                       ▼                             ▼
//                    NapiError                     chunk + full buffers
//                                                     │
//                                                     ▼
//                                          on end():
//                                           - flush rewriter
//                                           - normalize_born_canonical
//                                           - optionally optimize_for_publish
//                                           - return HtmlStreamResult
//
// Module structure:
//   buffer.rs    — Rc<RefCell<Vec<u8>>> pair shared with the lol-html OutputSink
//   slot_path.rs — incremental scanner with cross-chunk rolling tail
//   pipeline.rs  — composite HtmlRewriter that mirrors sync sanitize + tag

pub mod buffer;
pub mod pipeline;
pub mod slot_path;

use napi::{Error as NapiError, Result};

/// Resolved (non-Option) opts — internal; the napi-facing shape uses
/// `Option<bool>` so JS can pass `{}` and accept defaults.
#[derive(Debug, Clone, Copy)]
struct ResolvedOpts {
    inject_op_ids: bool,
    sanitize: bool,
    normalize_on_end: bool,
    minify_on_end: bool,
}

#[napi(object, js_name = "HtmlStreamOpts")]
#[derive(Default)]
pub struct JsHtmlStreamOpts {
    pub inject_op_ids: Option<bool>,
    pub sanitize: Option<bool>,
    pub normalize_on_end: Option<bool>,
    pub minify_on_end: Option<bool>,
}

#[napi(object, js_name = "HtmlStreamRemovedCounts")]
#[derive(Debug, Clone, Copy)]
pub struct JsStreamRemoved {
    pub scripts: u32,
    pub event_handlers: u32,
    pub dangerous_urls: u32,
    pub iframes: u32,
    pub meta_refresh: u32,
}

#[napi(object, js_name = "HtmlStreamResult")]
#[derive(Debug, Clone)]
pub struct JsHtmlStreamResult {
    /// Full document post-processed (sanitize + tag + normalize +
    /// optionally minify).
    pub final_html: String,
    pub bytes_in: u32,
    /// Total bytes emitted across all `write()` calls plus the trailing
    /// emit from `end()`. Roughly tracks `final_html.len()` before
    /// post-stream normalize/minify (those may shrink it slightly).
    pub bytes_out: u32,
    pub bytes_final: u32,
    pub op_ids_assigned: u32,
    pub sanitize_removed: JsStreamRemoved,
}

#[napi(js_name = "HtmlStream")]
pub struct HtmlStream {
    pipeline: pipeline::Pipeline,
    buffers: buffer::StreamBuffers,
    scanner: slot_path::StreamingSlotPathScanner,
    opts: ResolvedOpts,
    bytes_in: u32,
    bytes_out: u32,
    ended: bool,
}

#[napi]
impl HtmlStream {
    #[napi(constructor)]
    pub fn new(opts: Option<JsHtmlStreamOpts>) -> Self {
        let resolved = ResolvedOpts {
            inject_op_ids: opts.as_ref().and_then(|o| o.inject_op_ids).unwrap_or(true),
            sanitize: opts.as_ref().and_then(|o| o.sanitize).unwrap_or(true),
            normalize_on_end: opts
                .as_ref()
                .and_then(|o| o.normalize_on_end)
                .unwrap_or(true),
            minify_on_end: opts.as_ref().and_then(|o| o.minify_on_end).unwrap_or(false),
        };
        let buffers = buffer::StreamBuffers::new();
        let pipeline = pipeline::Pipeline::new(
            &buffers,
            pipeline::PipelineOpts {
                inject_op_ids: resolved.inject_op_ids,
                sanitize: resolved.sanitize,
            },
        );
        HtmlStream {
            pipeline,
            buffers,
            scanner: slot_path::StreamingSlotPathScanner::new(),
            opts: resolved,
            bytes_in: 0,
            bytes_out: 0,
            ended: false,
        }
    }

    /// Feed an HTML chunk. Returns the bytes lol-html emitted during
    /// this write (may be empty if lol-html is buffering an open tag;
    /// fully consumed bytes will arrive on a subsequent write or end).
    ///
    /// Errors:
    ///   - `data-slot-path detected (…)` — sticky once raised; further
    ///     writes will keep failing on the same detection.
    ///   - `HtmlStream.write() called after end()` — JS caller error.
    ///   - `pipeline write failed: …` — lol-html parsing-ambiguity or
    ///     memory-limit issues. The pipeline becomes poisoned; the
    ///     caller should drop the stream.
    #[napi]
    pub fn write(&mut self, chunk: String) -> Result<String> {
        if self.ended {
            return Err(NapiError::from_reason(
                "HtmlStream.write() called after end()",
            ));
        }
        if let Err(d) = self.scanner.feed(&chunk) {
            return Err(NapiError::from_reason(format!(
                "data-slot-path detected ({}, at byte offset {})",
                d.position, d.offset
            )));
        }
        self.buffers.clear_chunk();
        self.bytes_in += chunk.len() as u32;
        match self.pipeline.write(chunk.as_bytes()) {
            Ok(()) => {
                let s = self.buffers.take_chunk_string();
                self.bytes_out += s.len() as u32;
                Ok(s)
            }
            Err(e) => Err(NapiError::from_reason(format!(
                "pipeline write failed: {}",
                e
            ))),
        }
    }

    /// Finalize the stream. Applies normalize_born_canonical and
    /// (optionally) optimize_for_publish to the accumulated full
    /// document. Returns the post-processed HTML plus counters.
    #[napi]
    pub fn end(&mut self) -> Result<JsHtmlStreamResult> {
        if self.ended {
            return Err(NapiError::from_reason("HtmlStream.end() called twice"));
        }
        // Sticky check — if slot_path was hit during any write, this
        // re-raises so a caller that ignored the per-write Err still
        // gets a clean failure on end().
        if let Err(d) = self.scanner.finalize() {
            return Err(NapiError::from_reason(format!(
                "data-slot-path detected ({}, at byte offset {})",
                d.position, d.offset
            )));
        }
        if let Err(e) = self.pipeline.end() {
            return Err(NapiError::from_reason(format!(
                "pipeline end failed: {}",
                e
            )));
        }

        // Trailing chunk emit from lol-html's end() never gets handed to
        // a write() callback, so reconcile bytes_out against the full
        // buffer length.
        let bytes_after_flush = self.buffers.full_len() as u32;
        if bytes_after_flush > self.bytes_out {
            self.bytes_out = bytes_after_flush;
        }

        let mut final_html = self.buffers.full_as_string();
        if self.opts.normalize_on_end {
            final_html = crate::normalize::normalize_born_canonical(&final_html);
        }
        if self.opts.minify_on_end {
            let opt = crate::minify::optimize_for_publish(&final_html);
            match opt.html {
                Some(h) => final_html = h,
                None => {
                    return Err(NapiError::from_reason(format!(
                        "minify rejected final HTML: {}",
                        opt.errors.join("; ")
                    )));
                }
            }
        }

        self.ended = true;
        let removed = self.pipeline.removed_counts();
        let bytes_final = final_html.len() as u32;
        Ok(JsHtmlStreamResult {
            final_html,
            bytes_in: self.bytes_in,
            bytes_out: self.bytes_out,
            bytes_final,
            op_ids_assigned: self.pipeline.op_ids_assigned(),
            sanitize_removed: JsStreamRemoved {
                scripts: removed.scripts,
                event_handlers: removed.event_handlers,
                dangerous_urls: removed.dangerous_urls,
                iframes: removed.iframes,
                meta_refresh: removed.meta_refresh,
            },
        })
    }
}

// Rust-only convenience for integration tests that don't want to
// deal with napi::Error round-trips. Mirrors the napi class shape
// 1:1 — anything callable here is callable from JS too.
impl HtmlStream {
    pub fn bytes_in_raw(&self) -> u32 {
        self.bytes_in
    }

    pub fn bytes_out_raw(&self) -> u32 {
        self.bytes_out
    }

    pub fn full_buffer_len(&self) -> usize {
        self.buffers.full_len()
    }
}

/// Convenience: run the full stream pipeline over a slice of chunks.
/// Used by integration tests that want a one-shot comparison harness;
/// not exposed to JS (no `#[napi]` annotation).
pub fn run_stream(
    chunks: &[&str],
    inject_op_ids: bool,
    sanitize: bool,
    normalize_on_end: bool,
    minify_on_end: bool,
) -> std::result::Result<JsHtmlStreamResult, String> {
    let mut s = HtmlStream::new(Some(JsHtmlStreamOpts {
        inject_op_ids: Some(inject_op_ids),
        sanitize: Some(sanitize),
        normalize_on_end: Some(normalize_on_end),
        minify_on_end: Some(minify_on_end),
    }));
    for c in chunks {
        s.write(c.to_string()).map_err(|e| e.to_string())?;
    }
    s.end().map_err(|e| e.to_string())
}

#[cfg(test)]
mod theme_survival_tests {
    use super::run_stream;

    const DOC: &str = "<!doctype html><html><head><script src=\"https://cdn.tailwindcss.com\"></script></head><body><div class=\"rounded-lg p-4 text-xl\">x</div></body></html>";

    // Los scripts de tema NO dependen del sanitizado del stream: end() corre
    // normalize_born_canonical DESPUÉS de pipeline.end(), así que los inyecta
    // sobre el documento ya limpio. Este test es la red de af394eb.
    #[test]
    fn theme_scripts_present_after_full_stream() {
        let r = run_stream(&[DOC], false, true, true, false).unwrap();
        let html = r.final_html;
        for tag in [
            "<script data-ol-radius>",
            "<script data-ol-space>",
            "<script data-ol-type>",
            "<style data-ol-radius>",
        ] {
            assert!(html.contains(tag), "falta {tag} en la salida del stream");
        }
    }

    // Idempotencia: la razón que justificaba el whitelist. Volver a pasar un
    // documento YA normalizado por el stream no debe perder los tokens —
    // normalize_born_canonical los repone en end() aunque el sanitizado
    // los haya quitado por el camino.
    #[test]
    fn theme_scripts_survive_a_second_pass() {
        let once = run_stream(&[DOC], false, true, true, false)
            .unwrap()
            .final_html;
        let twice = run_stream(&[&once], false, true, true, false)
            .unwrap()
            .final_html;
        for tag in [
            "<script data-ol-radius>",
            "<script data-ol-space>",
            "<script data-ol-type>",
        ] {
            assert!(twice.contains(tag), "segunda pasada perdió {tag}");
        }
        // Y sin duplicarlos.
        assert_eq!(twice.matches("<style data-ol-radius").count(), 1);
        assert_eq!(twice.matches("<script data-ol-radius").count(), 1);
    }

    #[test]
    fn forged_theme_script_dies_but_canonical_one_returns() {
        let hostile = DOC.replace(
            "</head>",
            "<script data-ol-radius>window.__pwn=1</script></head>",
        );
        let html = run_stream(&[&hostile], false, true, true, false)
            .unwrap()
            .final_html;
        assert!(!html.contains("__pwn"), "el forjado sobrevivió");
        assert!(
            html.contains("<script data-ol-radius>"),
            "no volvió el canónico"
        );
        assert!(
            html.contains("var(--ol-r-sm)"),
            "el canónico no trae su contenido"
        );
    }
}
