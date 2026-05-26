// Byte-equal + idempotence tests for normalize::font. Fixture inputs are
// (radius then space then type then font).

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::{
    normalize_font, normalize_radius, normalize_space, normalize_type,
};

fn starter_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p
}

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/font");
    p
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

fn run_chain(src: &str) -> String {
    normalize_font(&normalize_type(&normalize_space(&normalize_radius(src))))
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
    let twice = normalize_font(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_counter() {
    let src = read(&starter_dir().join("counter.html"));
    let once = run_chain(&src);
    let twice = normalize_font(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_manuscript() {
    let src = read(&starter_dir().join("manuscript.html"));
    let once = run_chain(&src);
    let twice = normalize_font(&once);
    assert_eq!(once, twice);
}

#[test]
fn empty_returns_empty() {
    assert_eq!(normalize_font(""), "");
}

#[test]
fn no_op_on_one_font_page() {
    let html = "<head><style>body{font-family:'Inter',sans-serif}</style></head>";
    let out = normalize_font(html);
    assert_eq!(out, html);
}

#[test]
fn detects_display_font_and_rewrites() {
    let html = concat!(
        "<head><style>",
        "body{font-family:'Inter',sans-serif}",
        ".hero{font-family:'Playfair Display',serif}",
        "</style></head>"
    );
    let out = normalize_font(html);
    assert!(out.contains("data-ol-font"));
    assert!(out.contains("--ol-font-display:'Playfair Display',serif"));
    assert!(out.contains("font-family: var(--ol-font-display),serif"));
    assert!(out.contains("'Inter',sans-serif"));
}

#[test]
fn skips_mono_family() {
    let html = concat!(
        "<head><style>",
        "body{font-family:'Inter',sans-serif}",
        ".code{font-family:'JetBrains Mono',monospace}",
        "</style></head>"
    );
    let out = normalize_font(html);
    // Only one family (Inter, body) — display detection finds nothing
    // because mono is skipped and Inter == body. No-op.
    assert_eq!(out, html);
}
