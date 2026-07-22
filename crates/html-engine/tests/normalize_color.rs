// Byte-equal + idempotence tests for normalize::color. Fixture inputs are
// (radius then space then type then font then accent then color).

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::{
    normalize_accent, normalize_color, normalize_font, normalize_radius, normalize_space,
    normalize_type,
};

fn starter_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p
}

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/color");
    p
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

fn run_chain(src: &str) -> String {
    normalize_color(&normalize_accent(&normalize_font(&normalize_type(
        &normalize_space(&normalize_radius(src)),
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
    let twice = normalize_color(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_counter() {
    let src = read(&starter_dir().join("counter.html"));
    let once = run_chain(&src);
    let twice = normalize_color(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_manuscript() {
    let src = read(&starter_dir().join("manuscript.html"));
    let once = run_chain(&src);
    let twice = normalize_color(&once);
    assert_eq!(once, twice);
}

#[test]
fn empty_returns_empty() {
    assert_eq!(normalize_color(""), "");
}

#[test]
fn no_op_when_no_role_resolves() {
    let html = "<head><style>:root{--foo:#abc;--bar:#def}</style></head>";
    let out = normalize_color(html);
    assert_eq!(out, html);
}

#[test]
fn hoists_named_roles() {
    let html = "<head><style>:root{--bg:#ffffff;--fg:#111111;--border:#cccccc}</style></head>";
    let out = normalize_color(html);
    assert!(out.contains("--ol-bg:#ffffff"));
    assert!(out.contains("--ol-fg:#111111"));
    assert!(out.contains("--ol-border:#cccccc"));
    assert!(out.contains("--bg: var(--ol-bg)"));
    assert!(out.contains("--fg: var(--ol-fg)"));
}

#[test]
fn body_fallback_for_bg_and_fg() {
    let html =
        "<head><style>body{background-color:#fefefe;color:#101010}</style></head><body></body>";
    let out = normalize_color(html);
    assert!(out.contains("--ol-bg:#fefefe"));
    assert!(out.contains("--ol-fg:#101010"));
    assert!(out.contains("background-color: var(--ol-bg)"));
    assert!(out.contains("color: var(--ol-fg)"));
}

#[test]
fn body_fallback_skips_border_color() {
    // `border-color:` must NOT match the `(?<!-)color:` selector — the manual
    // lookbehind reproduces TS behavior.
    let html = "<head><style>body{border-color:#abcdef;color:#111111}</style></head>";
    let out = normalize_color(html);
    assert!(out.contains("--ol-fg:#111111"));
    // border-color stays intact.
    assert!(out.contains("border-color:#abcdef"));
}

#[test]
fn translucent_border_token_keeps_alpha() {
    // Kiri bug (Jesús, 2026-07-22): a template hairline like
    // rgba(255,255,255,0.06) must reach --ol-border WITH its alpha —
    // hexifying it flattens a 6% hair into a solid white line on every
    // dark clone.
    let html = "<head><style>:root{--bg:#000000;--hairline: rgba(255,255,255,0.06);}</style></head><body></body>";
    let out = normalize_color(html);
    assert!(
        out.contains("--hairline: var(--ol-border)"),
        "hairline should be bound: {out}"
    );
    assert!(
        out.contains("--ol-border:rgba(255,255,255,0.06);"),
        "token must keep its alpha: {out}"
    );
    assert!(
        !out.contains("--ol-border:#ffffff"),
        "must not flatten to solid white: {out}"
    );
}

#[test]
fn opaque_rgba_still_canonicalizes_to_hex() {
    let html = "<head><style>:root{--border: rgba(20,20,20,1);}</style></head><body></body>";
    let out = normalize_color(html);
    assert!(out.contains("--ol-border:#141414;"), "alpha=1 hexes: {out}");
}
