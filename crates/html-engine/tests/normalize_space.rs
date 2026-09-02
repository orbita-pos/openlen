// Byte-equal + idempotence tests for normalize::space. Fixture inputs are
// (normalizeRadius then normalizeSpace) output — matches the chain order.

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::{normalize_radius, normalize_space};

fn starter_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p
}

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/space");
    p
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

fn run_chain(src: &str) -> String {
    normalize_space(&normalize_radius(src))
}

fn byte_equal_on(template: &str) {
    let src = read(&starter_dir().join(template));
    let actual = run_chain(&src);
    let path = fixtures_dir().join(template);
    // REGENERAR: `OL_BLESS_FIXTURES=1 cargo test -p openlen-html-engine`.
    // Existe porque estas fixtures se quedaron desfasadas el 2026-08-26 —cuando
    // se retiraron dos pasadas— y nadie lo vio: no hay puerta de npm que corra
    // Rust, y rehacerlas a mano no era barato. Sin la variable, compara igual
    // que siempre.
    if std::env::var("OL_BLESS_FIXTURES").is_ok() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &actual).unwrap();
        return;
    }
    let expected = read(&path);
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
    let twice = normalize_space(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_counter() {
    let src = read(&starter_dir().join("counter.html"));
    let once = run_chain(&src);
    let twice = normalize_space(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_manuscript() {
    let src = read(&starter_dir().join("manuscript.html"));
    let once = run_chain(&src);
    let twice = normalize_space(&once);
    assert_eq!(once, twice);
}

#[test]
fn empty_returns_empty() {
    assert_eq!(normalize_space(""), "");
}

#[test]
fn appends_when_no_head() {
    let html = "<div>x</div>";
    let out = normalize_space(html);
    assert!(out.starts_with("<div>x</div>"));
    assert!(out.contains("data-ol-space"));
    assert!(out.contains("--ol-space-scale"));
}

#[test]
fn no_double_inject() {
    let once = normalize_space("<head></head>");
    let twice = normalize_space(&once);
    let count = once.matches("data-ol-space").count();
    assert!(count >= 1);
    assert_eq!(once, twice);
}
