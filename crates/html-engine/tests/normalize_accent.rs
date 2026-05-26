// Byte-equal + idempotence tests for normalize::accent. Fixture inputs are
// (radius then space then type then font then accent).

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::{
    normalize_accent, normalize_font, normalize_radius, normalize_space, normalize_type,
};

fn starter_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p
}

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/accent");
    p
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

fn run_chain(src: &str) -> String {
    normalize_accent(&normalize_font(&normalize_type(&normalize_space(
        &normalize_radius(src),
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
    let twice = normalize_accent(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_counter() {
    let src = read(&starter_dir().join("counter.html"));
    let once = run_chain(&src);
    let twice = normalize_accent(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_manuscript() {
    let src = read(&starter_dir().join("manuscript.html"));
    let once = run_chain(&src);
    let twice = normalize_accent(&once);
    assert_eq!(once, twice);
}

#[test]
fn empty_returns_empty() {
    assert_eq!(normalize_accent(""), "");
}

#[test]
fn no_accent_no_op() {
    let html = "<head><style>:root{--bg:#fff;--fg:#000}</style></head>";
    let out = normalize_accent(html);
    assert_eq!(out, html);
}

#[test]
fn named_accent_wins_over_chroma() {
    // The named "accent" (a muted gray, score < MIN_CHROMA on its own)
    // still wins because it carries the accent name.
    let html = "<head><style>:root{--accent:#445566;--brand-x:#ff0000}</style></head><body></body>";
    let out = normalize_accent(html);
    assert!(out.contains("--ol-accent:#445566"));
    assert!(out.contains("var(--ol-accent)"));
}

#[test]
fn chroma_picks_high_chroma_color() {
    let html = "<head><style>:root{--bg:#fafafa;--fg:#121212;--x:#ff5733}</style></head>";
    let out = normalize_accent(html);
    assert!(out.contains("--ol-accent:#ff5733"));
}

#[test]
fn skips_hex_followed_by_more_hex() {
    // #ff5733 inside #ff5733ff should NOT be replaced.
    let html =
        "<head><style>:root{--accent:#ff5733}.x{color:#ff5733ff}.y{color:#ff5733}</style></head>";
    let out = normalize_accent(html);
    assert!(out.contains("color:#ff5733ff"), "preserves 8-digit hex");
    assert!(out.contains(".y{color:var(--ol-accent)}"));
}

#[test]
fn rewrites_rgb_with_alpha() {
    let html =
        "<head><style>:root{--accent:#ff0000}.x{background:rgba(255,0,0,0.5)}</style></head>";
    let out = normalize_accent(html);
    assert!(out.contains("rgba(var(--ol-accent-r), 0.5)"));
}

#[test]
fn rewrites_rgb_no_alpha() {
    let html = "<head><style>:root{--accent:#ff0000}.x{color:rgb(255,0,0)}</style></head>";
    let out = normalize_accent(html);
    assert!(out.contains("rgb(var(--ol-accent-r))"));
}
