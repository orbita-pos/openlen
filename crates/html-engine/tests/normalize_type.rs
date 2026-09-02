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
fn no_reescribe_un_font_size_literal() {
    // ⚰️ ESTA PRUEBA EXIGÍA LO CONTRARIO. Pedía que `1.5rem` saliera como
    // `calc(1.5rem * var(--ol-text-scale))`, y esa reescritura se RETIRÓ el
    // 2026-08-26 con el resto del «dejamos de re-decidir el diseño del modelo»:
    // el modelo escribía un tamaño y salía otro, sin rastro.
    //
    // Se invierte en vez de borrarse — es el brazo de control. Si alguien
    // vuelve a meter la reescritura, esto lo dice.
    let html = "<head></head><style>.x{font-size:1.5rem}</style>";
    let out = normalize_type(html);
    // SE MIRA EL CUERPO, no el documento entero, y la distinción es la del
    // commit del 26/08: la pasada sigue INYECTANDO su vocabulario en el <head>
    // —y ahí `calc(1.5rem*var(--ol-text-scale))` aparece de verdad, porque
    // 1.5rem es el line-height de `base` y el tamaño de `2xl`—. Lo que ya no
    // hace es REESCRIBIR la regla que escribió el modelo. Afirmar sobre `out`
    // entero confunde las dos cosas.
    let cuerpo = out.split("</head>").last().unwrap();
    assert!(
        cuerpo.contains("font-size:1.5rem"),
        "el literal del modelo sale intacto"
    );
    assert!(
        !cuerpo.contains("calc("),
        "no puede re-decidir el tamaño del modelo"
    );
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
