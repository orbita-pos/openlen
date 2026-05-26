// Byte-equal + idempotence tests for normalize::type_pass. Fixture inputs
// are (radius then space then type) — the chain order through Sem 5-6.

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::{normalize_radius, normalize_space, normalize_type};

fn starter_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p
}

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/type");
    p
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

fn run_chain(src: &str) -> String {
    normalize_type(&normalize_space(&normalize_radius(src)))
}

fn byte_equal_on(template: &str) {
    let src = read(&starter_dir().join(template));
    let expected = read(&fixtures_dir().join(template));
    let actual = run_chain(&src);
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
    let once = run_chain(&src);
    let twice = normalize_type(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_counter() {
    let src = read(&starter_dir().join("counter.html"));
    let once = run_chain(&src);
    let twice = normalize_type(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_manuscript() {
    let src = read(&starter_dir().join("manuscript.html"));
    let once = run_chain(&src);
    let twice = normalize_type(&once);
    assert_eq!(once, twice);
}

#[test]
fn empty_returns_empty() {
    assert_eq!(normalize_type(""), "");
}

#[test]
fn scales_literal_font_size() {
    let html = "<head></head><style>.x{font-size:1.5rem}</style>";
    let out = normalize_type(html);
    assert!(out.contains("font-size: calc(1.5rem * var(--ol-text-scale))"));
}

#[test]
fn preserves_clamp_font_size() {
    let html = "<head></head><style>.x{font-size:clamp(1rem,2vw,2rem)}</style>";
    let out = normalize_type(html);
    assert!(out.contains("font-size:clamp(1rem,2vw,2rem)"));
}

#[test]
fn preserves_zero_font_size() {
    let html = "<head></head><style>.x{font-size:0px}</style>";
    let out = normalize_type(html);
    assert!(out.contains("font-size:0px"));
    assert!(!out.contains("calc(0px"));
}
