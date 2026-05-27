// Byte-equal + idempotence tests for normalize::radius — frozen fixtures
// under `tests/fixtures/{radius,space,type,font,accent,color,modes,chain}/`
// were generated from the legacy TS chain prior to its deletion in F1 S9
// and now serve as the static contract for the Rust port.

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::normalize_radius;

fn starter_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p
}

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/radius");
    p
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

fn byte_equal_on(template: &str) {
    let src = read(&starter_dir().join(template));
    let expected = read(&fixtures_dir().join(template));
    let actual = normalize_radius(&src);
    assert_eq!(actual, expected, "byte-equal mismatch on {}", template);
}

#[test]
fn byte_equal_mirror() {
    byte_equal_on("mirror.html");
}

#[test]
fn byte_equal_counter() {
    byte_equal_on("counter.html");
}

#[test]
fn byte_equal_manuscript() {
    byte_equal_on("manuscript.html");
}

#[test]
fn idempotent_mirror() {
    let src = read(&starter_dir().join("mirror.html"));
    let once = normalize_radius(&src);
    let twice = normalize_radius(&once);
    assert_eq!(once, twice, "second pass should be a no-op");
}

#[test]
fn idempotent_counter() {
    let src = read(&starter_dir().join("counter.html"));
    let once = normalize_radius(&src);
    let twice = normalize_radius(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_manuscript() {
    let src = read(&starter_dir().join("manuscript.html"));
    let once = normalize_radius(&src);
    let twice = normalize_radius(&once);
    assert_eq!(once, twice);
}

#[test]
fn empty_returns_empty() {
    assert_eq!(normalize_radius(""), "");
}

#[test]
fn appends_when_no_head() {
    let html = "<div>x</div>";
    let out = normalize_radius(html);
    assert!(out.starts_with("<div>x</div>"));
    assert!(out.contains("data-ol-radius"));
    assert!(out.contains("--ol-r-scale"));
}

#[test]
fn scales_literal_border_radius() {
    let html = "<head></head><style>.x{border-radius:0.5rem}</style>";
    let out = normalize_radius(html);
    assert!(out.contains("border-radius: calc(0.5rem * var(--ol-r-scale))"));
}

#[test]
fn preserves_pill_radius() {
    let html = "<head></head><style>.x{border-radius:9999px}</style>";
    let out = normalize_radius(html);
    assert!(out.contains("border-radius:9999px"), "{}", out);
    assert!(!out.contains("calc(9999px"));
}

#[test]
fn preserves_var_or_calc_radius() {
    let html = "<head></head><style>.x{border-radius:var(--foo)}</style>";
    let out = normalize_radius(html);
    assert!(out.contains("border-radius:var(--foo)"));
}
