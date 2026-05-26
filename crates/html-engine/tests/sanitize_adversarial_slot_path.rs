// Adversarial corpus for the slot_path gate. We generate 1000 deterministic
// HTML documents that each carry a `data-slot-path=` marker in some position
// + encoding + cosmetic variant. The whole corpus is asserted to be REJECTED
// by sanitize_for_publish (i.e. `r.html.is_none()` and `r.errors[0]` mentions
// data-slot-path). Zero leaks tolerated — a single failure is a security
// regression.
//
// The corpus is fully in-memory (no on-disk fixtures) because (a) there's no
// TS reference to byte-equal against — we're checking a binary "rejected vs
// leaked" outcome — and (b) keeping the generator alongside the assertions
// makes failures trivially reproducible (the failing doc is dumped to stdout).
//
// 10 surrounding-HTML contexts × 5 inject positions × 5 marker encodings ×
// 4 cosmetic mutations = 1000 unique docs.

use openlen_html_engine::sanitize::sanitize_for_publish;

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
    // The attribute *name* — possibly entity-encoded or mixed case — followed
    // by `=` (or `\t=`) and a value. Result must NOT include surrounding
    // tag boundaries; caller embeds it inside an element-opening context.
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
    // For text/comment/CDATA positions, mutation is mostly cosmetic — we vary
    // the trailing value so the corpus has 1000 unique docs.
    let attr_text = render_marker_attr(encoding, mutation);
    // Wrap in some surrounding text so the marker isn't at the very start.
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
            // CDATA is only legal in XML/SVG/MathML contexts in HTML5, but
            // browsers accept it in stray spots and the sanitizer must catch
            // markers regardless. We wrap an svg context for plausibility.
            let text = render_marker_text(encoding, mutation);
            format!("<svg><![CDATA[{}]]></svg>", text)
        }
    };
    ctx.replace("{INJECT}", &injection)
}

fn all_positions() -> Vec<Position> {
    vec![
        Position::AttrOnRoot,
        Position::AttrOnNested,
        Position::TextContent,
        Position::HtmlComment,
        Position::Cdata,
    ]
}

fn all_encodings() -> Vec<Encoding> {
    vec![
        Encoding::Literal,
        Encoding::MixedCase,
        Encoding::WhitespaceEquals,
        Encoding::EntityDecimalFirstChar,
        Encoding::EntityHexFirstChar,
    ]
}

fn all_mutations() -> Vec<Mutation> {
    vec![
        Mutation::DoubleQuotedValue,
        Mutation::SingleQuotedValue,
        Mutation::UnquotedValue,
        Mutation::ValueWithEntities,
    ]
}

#[test]
fn one_thousand_adversarial_docs_all_rejected() {
    let mut total = 0usize;
    let mut leaks: Vec<(usize, String)> = Vec::new();
    for (ci, ctx) in CONTEXTS.iter().enumerate() {
        for pos in all_positions() {
            for enc in all_encodings() {
                for mu in all_mutations() {
                    total += 1;
                    let doc = inject(ctx, pos, enc, mu);
                    let r = sanitize_for_publish(&doc);
                    let rejected =
                        r.html.is_none() && r.errors.iter().any(|e| e.contains("data-slot-path"));
                    if !rejected {
                        // First 8 leaks reported with the doc — enough to
                        // debug without flooding the failure output.
                        if leaks.len() < 8 {
                            leaks.push((ci, doc));
                        }
                    }
                }
            }
        }
    }
    assert_eq!(
        total, 1000,
        "corpus size sanity: expected 1000 docs, got {}",
        total
    );
    if !leaks.is_empty() {
        for (i, (ci, doc)) in leaks.iter().enumerate() {
            eprintln!("\n--- leak #{} (context {}) ---\n{}\n", i, ci, doc);
        }
        panic!(
            "slot_path gate leaked on {} out of {} adversarial docs",
            leaks.len(),
            total
        );
    }
}

#[test]
fn corpus_size_is_exactly_1000() {
    // Sanity check that the cartesian product really is 1000 — if we add
    // contexts/positions/encodings/mutations without updating this, the test
    // catches the off-by-one.
    let total =
        CONTEXTS.len() * all_positions().len() * all_encodings().len() * all_mutations().len();
    assert_eq!(total, 1000);
}

#[test]
fn random_clean_docs_not_rejected() {
    // Symmetry check: docs that look LIKE the adversarial shape (using a
    // similar template) but DON'T contain data-slot-path should pass through
    // cleanly. Catches a regression where the gate gets too eager and starts
    // rejecting innocent HTML.
    let clean_docs = [
        "<div data-other-thing=\"x\">marker</div>",
        "<p>some quote: data-different-path=foo</p>",
        "<!-- random comment about slot stuff --><div>x</div>",
        "<svg><![CDATA[harmless content]]></svg>",
        "<a href=\"/?data-slot=foo\">link</a>",
        "<div class=\"data-slot-foo\">x</div>",
        "<span title=\"how data-slot-path works\">x</span>", // no `=`, not a marker
    ];
    for d in clean_docs.iter() {
        let r = sanitize_for_publish(d);
        assert!(
            r.html.is_some(),
            "false positive: clean doc rejected: {}\nerrors: {:?}",
            d,
            r.errors
        );
    }
    // The gate matches `data-slot-path=` (with optional whitespace). The
    // string `data-slot-path` without `=` is not a marker, so it passes —
    // even when sitting in an attribute value or text. This matches the TS
    // reference's `html.includes("data-slot-path=")` semantics.
    //
    // The text-content + `=` case IS rejected (zero-tolerance): the marker
    // could be a hint to the editor or a payload for a later parser step.
    let rejected = "<span title=\"how data-slot-path=foo works\">x</span>";
    let r = sanitize_for_publish(rejected);
    assert!(
        r.html.is_none(),
        "policy: zero-tolerance includes text-content `data-slot-path=` occurrences",
    );
}
