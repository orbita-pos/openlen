// Composite lol-html streaming rewriter.
//
// The streaming HTML pipeline runs **one** `lol-html::HtmlRewriter`
// with a single `*` element handler. Inside that handler we dispatch
// per element to the equivalent of sync `sanitize_for_publish`'s
// 4 passes (scripts, dangerous elements, meta-refresh, event-handler
// strip, URL strip) followed by the op-id tagger from `ops::tagger`.
//
// Why one handler instead of registering separate `script` /
// `iframe, …` / `meta[http-equiv]` / `*` selectors and letting lol-html
// dispatch on its own:
//
//   - **Counter parity with the sync pipeline.** When a `<script>` /
//     `<iframe>` / `<meta http-equiv="refresh">` element is removed,
//     the subsequent passes in the sync pipeline never see it.
//     Separate lol-html handlers all fire on the same element (per
//     `handler_invocation_order` test in lol-html), so onclick/href
//     strippers would count attributes on an already-removed element.
//     With the composite + early-return pattern, removed elements
//     bypass later counters — matching what `sanitize_for_publish`
//     reports.
//
//   - **Op-id sequencing on clean elements.** The op-id tagger only
//     ever runs after the strippers in this layout, so sequential
//     op-ids are assigned only to elements that survive sanitize.
//     On `sanitize-clean` inputs (the three starter templates) the
//     resulting tagged HTML is byte-equal to the sync chain
//     `sanitize_for_publish(html).html.then(tag_with_op_ids)` — which
//     is the test we hold byte-equal against.
//
// One known divergence vs the sync chain: on inputs *with* dangerous
// non-SKIP-TAGS elements (e.g. an `<iframe>`), the sync chain runs
// `tag_with_op_ids` first and assigns an op-id to the iframe before
// `sanitize` removes it. The streaming pipeline removes the iframe
// first (early-return) so no op-id is wasted. Surviving elements
// still get unique op-ids in a contiguous sequence — the count just
// differs by the number of removed-dangerous-non-skip elements.
// Editor / F3 consumers don't care; they want unique addressable
// op-ids and that contract holds.

use std::cell::Cell;
use std::rc::Rc;

use lol_html::{element, HtmlRewriter, Settings};
use once_cell::sync::Lazy;
use regex::Regex;

use crate::ops::id::base36;
use crate::sanitize::RemovedCounts;
use crate::stream::buffer::{SinkFn, StreamBuffers};

const OP_ID_ATTR: &str = "data-op-id";

const SKIP_TAGS: &[&str] = &[
    "html", "head", "meta", "title", "link", "script", "style", "noscript", "br", "hr",
];

const DANGEROUS_ELEMENTS: &[&str] = &["iframe", "object", "embed", "applet", "portal"];
const URL_ATTRS: &[&str] = &["href", "src", "action", "formaction", "background", "ping"];
const ALLOWED_SCRIPT_SRCS: &[&str] = &[
    "https://cdn.tailwindcss.com",
    "https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,line-clamp",
];

// Mirror of `sanitize::urls::DANGEROUS_URL_SCHEME`. Duplicated rather
// than re-exported because the sync sanitize module owns its regex
// private to the file. The pattern body is short and tested
// byte-equal-via-streaming against the sync output, so drift would
// surface immediately in the byte_equal tests.
static DANGEROUS_URL_SCHEME: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)^\s*(javascript|vbscript|data:text/html|data:image/svg\+xml.*script)")
        .expect("hard-coded regex must compile")
});

fn is_event_handler_attr(name: &str) -> bool {
    let b = name.as_bytes();
    if b.len() < 3 {
        return false;
    }
    if !(b[0].eq_ignore_ascii_case(&b'o') && b[1].eq_ignore_ascii_case(&b'n')) {
        return false;
    }
    b[2..].iter().all(|c| c.is_ascii_alphabetic())
}

fn is_dangerous_url(value: &str) -> bool {
    DANGEROUS_URL_SCHEME.is_match(value)
}

#[derive(Default, Clone)]
pub struct PipelineCounters {
    pub op_ids: Rc<Cell<u32>>,
    pub scripts: Rc<Cell<u32>>,
    pub iframes: Rc<Cell<u32>>,
    pub meta_refresh: Rc<Cell<u32>>,
    pub event_handlers: Rc<Cell<u32>>,
    pub dangerous_urls: Rc<Cell<u32>>,
}

#[derive(Debug, Clone, Copy)]
pub struct PipelineOpts {
    pub inject_op_ids: bool,
    pub sanitize: bool,
}

impl Default for PipelineOpts {
    fn default() -> Self {
        Self {
            inject_op_ids: true,
            sanitize: true,
        }
    }
}

pub struct Pipeline {
    /// `None` once `end()` has been called. lol-html's `end` takes
    /// `self` by value, so the Option lets us move it out behind
    /// `&mut self`.
    rewriter: Option<HtmlRewriter<'static, SinkFn>>,
    counters: PipelineCounters,
    /// Once a `RewritingError` is hit, lol-html panics on subsequent
    /// use; the wrapper short-circuits further calls so JS sees a
    /// clean error instead.
    poisoned: bool,
}

impl Pipeline {
    pub fn new(buffers: &StreamBuffers, opts: PipelineOpts) -> Self {
        let counters = PipelineCounters::default();
        let sink: SinkFn = buffers.sink();

        let op_ids = Rc::clone(&counters.op_ids);
        let scripts = Rc::clone(&counters.scripts);
        let iframes = Rc::clone(&counters.iframes);
        let meta_refresh = Rc::clone(&counters.meta_refresh);
        let event_handlers = Rc::clone(&counters.event_handlers);
        let dangerous_urls = Rc::clone(&counters.dangerous_urls);

        let composite = element!("*", move |el| {
            let tag = el.tag_name().to_ascii_lowercase();

            // 1. scripts (whitelist-aware)
            if opts.sanitize && tag == "script" {
                let src = el.get_attribute("src").unwrap_or_default();
                let trimmed = src.trim();
                if !trimmed.is_empty() && ALLOWED_SCRIPT_SRCS.contains(&trimmed) {
                    // Allowed Tailwind CDN — leave intact, also skip the
                    // op-id tagger (script is in SKIP_TAGS anyway).
                    return Ok(());
                }
                // Aquí hubo un whitelist por PREFIJO de atributo
                // (`data-ol-*`) para no romper la idempotencia sobre HTML ya
                // normalizado. Se quitó (auditoría 2026-07-29): un atributo no
                // autentica nada — el HTML que entra lo escribe un LLM sobre
                // un brief del usuario, así que `<script data-ol-loquesea>`
                // pasaba igual, y de ahí llegaba a la DB y al iframe del
                // editor (que corre allow-same-origin).
                //
                // La idempotencia no lo necesitaba: HtmlStream::end() llama a
                // normalize_born_canonical DESPUÉS de pipeline.end()
                // (stream/mod.rs:198), así que los scripts de tema se
                // re-inyectan sobre el documento ya limpio; y el wrapper de TS
                // los repara otra vez con ensure_theme_scripts. Cubierto por
                // los tests de stream::theme_survival_tests.
                el.remove();
                scripts.set(scripts.get() + 1);
                return Ok(());
            }

            // 2. dangerous embed containers
            if opts.sanitize && DANGEROUS_ELEMENTS.contains(&tag.as_str()) {
                el.remove();
                iframes.set(iframes.get() + 1);
                return Ok(());
            }

            // 3. meta http-equiv refresh / set-cookie
            if opts.sanitize && tag == "meta" {
                if let Some(v) = el.get_attribute("http-equiv") {
                    let lv = v.trim().to_ascii_lowercase();
                    if lv == "refresh" || lv == "set-cookie" {
                        el.remove();
                        meta_refresh.set(meta_refresh.get() + 1);
                        return Ok(());
                    }
                }
            }

            // 4. event-handler attributes (any element)
            if opts.sanitize {
                let names: Vec<String> = el
                    .attributes()
                    .iter()
                    .map(|a| a.name())
                    .filter(|n| is_event_handler_attr(n))
                    .collect();
                for n in names {
                    el.remove_attribute(&n);
                    event_handlers.set(event_handlers.get() + 1);
                }

                // 5. URL-bearing attrs with dangerous schemes
                let url_names: Vec<String> = el
                    .attributes()
                    .iter()
                    .filter_map(|a| {
                        let name = a.name();
                        if !URL_ATTRS.iter().any(|u| u.eq_ignore_ascii_case(&name)) {
                            return None;
                        }
                        if is_dangerous_url(&a.value()) {
                            Some(name)
                        } else {
                            None
                        }
                    })
                    .collect();
                for n in url_names {
                    el.remove_attribute(&n);
                    dangerous_urls.set(dangerous_urls.get() + 1);
                }
            }

            // 6. op-id tagger
            if opts.inject_op_ids
                && !SKIP_TAGS.iter().any(|t| t.eq_ignore_ascii_case(&tag))
                && el.get_attribute(OP_ID_ATTR).is_none()
            {
                let id = base36(op_ids.get());
                op_ids.set(op_ids.get() + 1);
                el.set_attribute(OP_ID_ATTR, &id)
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
            }

            Ok(())
        });

        let settings = Settings {
            element_content_handlers: vec![composite],
            ..Settings::default()
        };

        let rewriter = HtmlRewriter::new(settings, sink);

        Pipeline {
            rewriter: Some(rewriter),
            counters,
            poisoned: false,
        }
    }

    /// Write bytes into the rewriter. On Err the pipeline becomes
    /// poisoned and further calls short-circuit with an error string.
    pub fn write(&mut self, chunk: &[u8]) -> Result<(), lol_html::errors::RewritingError> {
        if self.poisoned {
            return Err(lol_html::errors::RewritingError::ContentHandlerError(
                "pipeline poisoned by an earlier error".into(),
            ));
        }
        let Some(r) = self.rewriter.as_mut() else {
            return Err(lol_html::errors::RewritingError::ContentHandlerError(
                "pipeline already ended".into(),
            ));
        };
        match r.write(chunk) {
            Ok(()) => Ok(()),
            Err(e) => {
                self.poisoned = true;
                self.rewriter = None;
                Err(e)
            }
        }
    }

    pub fn end(&mut self) -> Result<(), lol_html::errors::RewritingError> {
        if self.poisoned {
            return Err(lol_html::errors::RewritingError::ContentHandlerError(
                "pipeline poisoned by an earlier error".into(),
            ));
        }
        match self.rewriter.take() {
            Some(r) => r.end(),
            None => Err(lol_html::errors::RewritingError::ContentHandlerError(
                "pipeline already ended".into(),
            )),
        }
    }

    pub fn op_ids_assigned(&self) -> u32 {
        self.counters.op_ids.get()
    }

    pub fn removed_counts(&self) -> RemovedCounts {
        RemovedCounts {
            scripts: self.counters.scripts.get(),
            event_handlers: self.counters.event_handlers.get(),
            dangerous_urls: self.counters.dangerous_urls.get(),
            iframes: self.counters.iframes.get(),
            meta_refresh: self.counters.meta_refresh.get(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(input: &str, opts: PipelineOpts) -> (String, RemovedCounts, u32) {
        let buffers = StreamBuffers::new();
        let mut p = Pipeline::new(&buffers, opts);
        p.write(input.as_bytes()).unwrap();
        p.end().unwrap();
        (
            buffers.full_as_string(),
            p.removed_counts(),
            p.op_ids_assigned(),
        )
    }

    #[test]
    fn tag_only_on_clean_input() {
        let (out, removed, op_ids) = stream(
            "<div><p>hi</p></div>",
            PipelineOpts {
                inject_op_ids: true,
                sanitize: false,
            },
        );
        assert!(out.contains("data-op-id=\"0\""));
        assert!(out.contains("data-op-id=\"1\""));
        assert_eq!(removed.scripts, 0);
        assert_eq!(op_ids, 2);
    }

    #[test]
    fn sanitize_strips_script_in_one_pass() {
        let (out, removed, _) = stream(
            "<p>x</p><script>alert(1)</script>",
            PipelineOpts {
                inject_op_ids: false,
                sanitize: true,
            },
        );
        assert!(!out.contains("<script"));
        assert_eq!(removed.scripts, 1);
    }

    #[test]
    fn composite_strips_and_tags() {
        let (out, removed, op_ids) = stream(
            "<div onclick=\"x\"><script>bad()</script><p>hi</p></div>",
            PipelineOpts::default(),
        );
        assert!(!out.contains("<script"));
        assert!(!out.contains("onclick"));
        assert!(out.contains("data-op-id"));
        assert_eq!(removed.scripts, 1);
        assert_eq!(removed.event_handlers, 1);
        assert_eq!(op_ids, 2); // div + p, script is SKIP_TAGS so no waste
    }

    #[test]
    fn iframe_removed_before_tagger_so_no_wasted_op_id() {
        // The whole point of the composite-with-early-return layout:
        // an iframe gets removed and the tagger never assigns an op-id
        // to it, so the surviving op-id sequence is dense.
        let (out, removed, op_ids) = stream(
            "<div><iframe src=\"x\"></iframe><p>hi</p></div>",
            PipelineOpts::default(),
        );
        assert!(!out.contains("<iframe"));
        assert_eq!(removed.iframes, 1);
        // div=0, p=1 — iframe was removed before tagging
        assert_eq!(op_ids, 2);
        assert!(out.contains("data-op-id=\"0\""));
        assert!(out.contains("data-op-id=\"1\""));
    }

    #[test]
    fn empty_input_passes_through() {
        let buffers = StreamBuffers::new();
        let mut p = Pipeline::new(&buffers, PipelineOpts::default());
        p.write(b"").unwrap();
        p.end().unwrap();
        assert_eq!(buffers.full_as_string(), "");
    }

    #[test]
    fn write_after_end_errors() {
        let buffers = StreamBuffers::new();
        let mut p = Pipeline::new(&buffers, PipelineOpts::default());
        p.write(b"<div>x</div>").unwrap();
        p.end().unwrap();
        assert!(p.write(b"more").is_err());
    }

    const SANITIZE: PipelineOpts = PipelineOpts {
        inject_op_ids: false,
        sanitize: true,
    };

    // El whitelist por PREFIJO de atributo no autenticaba nada: el HTML que
    // entra al stream lo escribe un LLM sobre un brief del usuario, así que
    // cualquiera podía emitir <script data-ol-loquesea> y sobrevivir. Los
    // scripts de tema legítimos NO dependen de esto: normalize_born_canonical
    // corre en HtmlStream::end() DESPUÉS del sanitizado (stream/mod.rs:198) y
    // los vuelve a poner; el wrapper de TS los repara otra vez con
    // ensure_theme_scripts. Auditoría 2026-07-29.
    #[test]
    fn forged_data_ol_script_is_stripped() {
        let (out, removed, _) = stream("<p>x</p><script data-ol-radius>evil()</script>", SANITIZE);
        assert!(
            !out.contains("evil()"),
            "el script forjado sobrevivió: {out}"
        );
        assert!(!out.contains("<script"));
        assert_eq!(removed.scripts, 1);
    }

    #[test]
    fn forged_arbitrary_ol_attribute_is_stripped() {
        let (out, removed, _) = stream(
            "<script data-ol-pwn>steal(document.cookie)</script>",
            SANITIZE,
        );
        assert!(!out.contains("steal("));
        assert_eq!(removed.scripts, 1);
    }

    #[test]
    fn tailwind_cdn_still_survives() {
        let (out, removed, _) = stream(
            "<script src=\"https://cdn.tailwindcss.com\"></script><p>x</p>",
            SANITIZE,
        );
        assert!(out.contains("cdn.tailwindcss.com"));
        assert_eq!(removed.scripts, 0);
    }
}
