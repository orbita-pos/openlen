// End-to-end byte-equal + idempotence tests for the full normalizer chain.
// The chain fixture mirrors `normalizeBornCanonical` in lib/normalize.ts.

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::normalize_born_canonical;

fn starter_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p
}

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/chain");
    p
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
}

fn byte_equal_on(template: &str) {
    let src = read(&starter_dir().join(template));
    let actual = normalize_born_canonical(&src);
    let path = fixtures_dir().join(template);
    // REGENERAR: `OL_BLESS_FIXTURES=1 cargo test -p openlen-html-engine`.
    // Ver la nota en normalize_type.rs: estas fixtures se quedaron desfasadas
    // el 2026-08-26 y nadie lo vio porque ninguna puerta de npm corre Rust.
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
    let once = normalize_born_canonical(&src);
    let twice = normalize_born_canonical(&once);
    assert_eq!(once, twice, "running the chain twice should be a no-op");
}

#[test]
fn idempotent_counter() {
    let src = read(&starter_dir().join("counter.html"));
    let once = normalize_born_canonical(&src);
    let twice = normalize_born_canonical(&once);
    assert_eq!(once, twice);
}

#[test]
fn idempotent_manuscript() {
    let src = read(&starter_dir().join("manuscript.html"));
    let once = normalize_born_canonical(&src);
    let twice = normalize_born_canonical(&once);
    assert_eq!(once, twice);
}

#[test]
fn empty_returns_empty() {
    assert_eq!(normalize_born_canonical(""), "");
}
