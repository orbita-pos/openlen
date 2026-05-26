use openlen_html_engine::parser::round_trip;

const COUNTER: &str = include_str!("../../../templates/starter/counter.html");
const MANUSCRIPT: &str = include_str!("../../../templates/starter/manuscript.html");
const MIRROR: &str = include_str!("../../../templates/starter/mirror.html");

#[test]
fn empty_input_returns_empty() {
    assert_eq!(round_trip("").unwrap(), "");
}

#[test]
fn fragment_passthrough() {
    let out = round_trip("<div>hi</div>").unwrap();
    assert!(out.contains("<div>hi</div>"));
}

#[test]
fn fixture_counter_non_empty() {
    let out = round_trip(COUNTER).unwrap();
    assert!(
        !out.is_empty(),
        "counter.html round-trip produced empty output"
    );
    assert!(
        out.contains("</html>") || out.contains("</body>"),
        "counter.html lost top-level structure"
    );
}

#[test]
fn fixture_manuscript_non_empty() {
    let out = round_trip(MANUSCRIPT).unwrap();
    assert!(!out.is_empty());
    assert!(out.contains("</html>") || out.contains("</body>"));
}

#[test]
fn fixture_mirror_non_empty() {
    let out = round_trip(MIRROR).unwrap();
    assert!(!out.is_empty());
    assert!(out.contains("</html>") || out.contains("</body>"));
}

#[test]
fn idempotent_two_passes_equal() {
    // Running the round-trip twice produces the same output as once — the
    // serializer is deterministic. This is the invariant every normalize
    // pass will also have to satisfy.
    let once = round_trip(COUNTER).unwrap();
    let twice = round_trip(&once).unwrap();
    assert_eq!(once, twice, "round_trip is not idempotent");
}

#[test]
fn text_content_preserved() {
    // We can't byte-equal the output to the input (lol-html may normalize
    // attribute quoting and self-closing forms), but the visible text
    // content of the document must be preserved verbatim. Strip tags and
    // compare on text.
    let input = "<p>Hello <strong>world</strong>, this is a test.</p>";
    let out = round_trip(input).unwrap();
    let stripped = strip_tags(&out);
    let expected = "Hello world, this is a test.";
    assert_eq!(stripped.trim(), expected);
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}
