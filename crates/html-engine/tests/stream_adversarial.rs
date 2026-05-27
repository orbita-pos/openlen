// 1000-doc adversarial slot-path corpus, streamed.
//
// Mirrors `sanitize_adversarial_slot_path::one_thousand_adversarial_docs_all_rejected`
// but feeds each document through `HtmlStream` (chunked) instead of the
// one-shot sync `sanitize_for_publish`. Streaming must catch every
// variant the sync gate catches.
//
// 10 contexts × 5 positions × 5 encodings × 4 mutations = 1000 unique
// docs. For each, we split into 8 chunks (covers cross-boundary cases
// for most variants) and verify either:
//   - a write() returns Err (the marker was seen in this chunk + tail), OR
//   - end() returns Err (the marker was seen across writes and final).
//
// A leak = both write() and end() returned Ok. Zero tolerance.

use openlen_html_engine::stream::{HtmlStream, JsHtmlStreamOpts};

#[derive(Clone, Copy)]
enum Position {
    AttrOnRoot,
    AttrOnNested,
    TextContent,
    HtmlComment,
    Cdata,
}

#[derive(Clone, Copy)]
enum Encoding {
    Literal,
    MixedCase,
    WhitespaceEquals,
    EntityDecimalFirstChar,
    EntityHexFirstChar,
}

#[derive(Clone, Copy)]
enum Mutation {
    DoubleQuotedValue,
    SingleQuotedValue,
    UnquotedValue,
    ValueWithEntities,
}

const CONTEXTS: &[&str] = &[
    "<!doctype html><html><body>{INJECT}</body></html>",
    "<section>{INJECT}</section>",
    "<header><nav>{INJECT}</nav></header>",
    "<main class=\"hero\"><h1>Title</h1>{INJECT}<p>after</p></main>",
    "<article id=\"a1\">{INJECT}</article>",
    "<div class=\"grid\"><div class=\"col\">{INJECT}</div></div>",
    "<footer>copyright 2026 {INJECT}</footer>",
    "<p>before</p>{INJECT}<p>after</p>",
    "<ul><li>one</li>{INJECT}<li>two</li></ul>",
    "<div><svg width=\"10\" height=\"10\"><rect/></svg>{INJECT}<p>x</p></div>",
];

fn render_marker_attr(encoding: Encoding, mutation: Mutation) -> String {
    let name = match encoding {
        Encoding::Literal | Encoding::WhitespaceEquals => "data-slot-path".to_string(),
        Encoding::MixedCase => "Data-Slot-Path".to_string(),
        Encoding::EntityDecimalFirstChar => "&#100;ata-slot-path".to_string(),
        Encoding::EntityHexFirstChar => "&#x64;ata-slot-path".to_string(),
    };
    let eq = if matches!(encoding, Encoding::WhitespaceEquals) {
        " =\t"
    } else {
        "="
    };
    let value = match mutation {
        Mutation::DoubleQuotedValue => "\"hero.title\"".to_string(),
        Mutation::SingleQuotedValue => "'hero.title'".to_string(),
        Mutation::UnquotedValue => "hero.title".to_string(),
        Mutation::ValueWithEntities => "\"hero&amp;title\"".to_string(),
    };
    format!("{}{}{}", name, eq, value)
}

fn render_marker_text(encoding: Encoding, mutation: Mutation) -> String {
    let attr_text = render_marker_attr(encoding, mutation);
    format!("here is a quote: {}", attr_text)
}

fn inject(ctx: &str, position: Position, encoding: Encoding, mutation: Mutation) -> String {
    let injection = match position {
        Position::AttrOnRoot => {
            let attr = render_marker_attr(encoding, mutation);
            format!("<div {}>marker</div>", attr)
        }
        Position::AttrOnNested => {
            let attr = render_marker_attr(encoding, mutation);
            format!("<div><span><em {}>marker</em></span></div>", attr)
        }
        Position::TextContent => {
            let text = render_marker_text(encoding, mutation);
            format!("<p>{}</p>", text)
        }
        Position::HtmlComment => {
            let text = render_marker_text(encoding, mutation);
            format!("<!-- {} --><p>x</p>", text)
        }
        Position::Cdata => {
            let text = render_marker_text(encoding, mutation);
            format!("<svg><![CDATA[{}]]></svg>", text)
        }
    };
    ctx.replace("{INJECT}", &injection)
}

fn split_eight(s: &str) -> Vec<String> {
    if s.is_empty() {
        return vec![];
    }
    let n = 8;
    let target = s.len() / n;
    let mut out = Vec::with_capacity(n + 1);
    let mut i = 0;
    while i < s.len() {
        let goal = (i + target.max(1)).min(s.len());
        let end = (goal..=s.len()).find(|&j| s.is_char_boundary(j)).unwrap();
        out.push(s[i..end].to_string());
        i = end;
    }
    out
}

fn fresh_stream() -> HtmlStream {
    HtmlStream::new(Some(JsHtmlStreamOpts {
        inject_op_ids: Some(true),
        sanitize: Some(true),
        normalize_on_end: Some(false),
        minify_on_end: Some(false),
    }))
}

#[test]
fn one_thousand_adversarial_docs_streamed_all_rejected() {
    let positions = [
        Position::AttrOnRoot,
        Position::AttrOnNested,
        Position::TextContent,
        Position::HtmlComment,
        Position::Cdata,
    ];
    let encodings = [
        Encoding::Literal,
        Encoding::MixedCase,
        Encoding::WhitespaceEquals,
        Encoding::EntityDecimalFirstChar,
        Encoding::EntityHexFirstChar,
    ];
    let mutations = [
        Mutation::DoubleQuotedValue,
        Mutation::SingleQuotedValue,
        Mutation::UnquotedValue,
        Mutation::ValueWithEntities,
    ];

    let mut total = 0usize;
    let mut leaks: Vec<(usize, String)> = Vec::new();
    for (ci, ctx) in CONTEXTS.iter().enumerate() {
        for pos in positions {
            for enc in encodings {
                for mu in mutations {
                    total += 1;
                    let doc = inject(ctx, pos, enc, mu);
                    let chunks = split_eight(&doc);
                    let mut stream = fresh_stream();
                    let mut rejected = false;
                    for chunk in &chunks {
                        if stream.write(chunk.clone()).is_err() {
                            rejected = true;
                            break;
                        }
                    }
                    if !rejected {
                        // No write hit — the closer test is end().
                        rejected = stream.end().is_err();
                    }
                    if !rejected && leaks.len() < 8 {
                        leaks.push((ci, doc));
                    }
                }
            }
        }
    }
    assert_eq!(total, 1000, "corpus size sanity: expected 1000");
    if !leaks.is_empty() {
        for (i, (ci, doc)) in leaks.iter().enumerate() {
            eprintln!(
                "\n--- streaming leak #{} (context {}) ---\n{}\n",
                i, ci, doc
            );
        }
        panic!(
            "streaming slot_path gate leaked on {}/{} adversarial docs",
            leaks.len(),
            total
        );
    }
}

#[test]
fn clean_lookalikes_not_falsely_rejected_via_streaming() {
    let clean_docs = [
        "<div data-other-thing=\"x\">marker</div>",
        "<p>some quote: data-different-path=foo</p>",
        "<div class=\"data-slot-foo\">x</div>",
        "<a href=\"/?data-slot=foo\">link</a>",
    ];
    for d in clean_docs.iter() {
        let mut stream = fresh_stream();
        let chunks = split_eight(d);
        let mut hit_error = false;
        for c in &chunks {
            if stream.write(c.clone()).is_err() {
                hit_error = true;
                break;
            }
        }
        let end_ok = if hit_error {
            false
        } else {
            stream.end().is_ok()
        };
        assert!(end_ok, "false positive on clean doc: {}", d);
    }
}
