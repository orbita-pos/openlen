// Byte-equal + idempotence tests for normalize::modes. Fixture inputs are
// the full 7-pass chain — modes is the last step.

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::{
    normalize_accent, normalize_color, normalize_color_modes, normalize_font, normalize_radius,
    normalize_space, normalize_type,
};

fn starter_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p
}

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/modes");
    p
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

fn run_chain(src: &str) -> String {
    normalize_color_modes(&normalize_color(&normalize_accent(&normalize_font(
        &normalize_type(&normalize_space(&normalize_radius(src))),
    ))))
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
    let twice = normalize_color_modes(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_counter() {
    let src = read(&starter_dir().join("counter.html"));
    let once = run_chain(&src);
    let twice = normalize_color_modes(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_manuscript() {
    let src = read(&starter_dir().join("manuscript.html"));
    let once = run_chain(&src);
    let twice = normalize_color_modes(&once);
    assert_eq!(once, twice);
}

#[test]
fn empty_returns_empty() {
    assert_eq!(normalize_color_modes(""), "");
}

#[test]
fn no_op_when_no_dark_palette() {
    let html = "<head><style>:root{--bg:#fff}</style></head>";
    let out = normalize_color_modes(html);
    assert_eq!(out, html);
}

#[test]
fn lifts_dark_palette_and_drops_block() {
    let html = "<head><style>:root.dark{--bg:#0a0a0a;--fg:#fafafa;--accent:#ff5733}</style></head>";
    let out = normalize_color_modes(html);
    assert!(!out.contains(":root.dark"));
    assert!(out.contains(r#":root[data-ol-mode="dark"]"#));
    assert!(out.contains("--ol-bg:#0a0a0a"));
    assert!(out.contains("--ol-fg:#fafafa"));
    assert!(out.contains("--ol-accent:#ff5733"));
    assert!(out.contains("--ol-accent-r:255,87,51"));
}
