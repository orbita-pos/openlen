// Byte-equal + idempotence tests for normalize::modes. Fixture inputs are
// the full 7-pass chain — modes is the last step.

use std::fs;
use std::path::{Path, PathBuf};

use openlen_html_engine::normalize::{
    normalize_color, normalize_color_modes, normalize_radius, normalize_space, normalize_type,
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
    normalize_color_modes(&normalize_color(&normalize_type(&normalize_space(
        &normalize_radius(src),
    ))))
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

// ── La paleta oscura entera (2026-09-09) ──────────────────────────────────
// Antes sólo salían los cinco roles y el resto se tiraba. Los tokens perdidos
// se quedaban con su valor del modo CLARO, y como el fondo sí volteaba, el
// texto secundario acababa oscuro sobre oscuro.

#[test]
fn carries_every_token_the_model_wrote() {
    let html = "<head><style>:root.dark{--bg:#0f172a;--surface:#1e293b;--fg:#f1f5f9;\
--border:#334155;--accent:#60a5fa;--accent-r:96,165,250;--accent-ink:#0f172a;\
--surface-2:#334155;--fg-muted:#cbd5e1;--fg-faint:#94a3b8;--border-strong:#475569;\
--warn:#f59e0b}</style></head>";
    let out = normalize_color_modes(html);
    // Los cinco roles, como --ol-*.
    for t in [
        "--ol-bg:#0f172a",
        "--ol-surface:#1e293b",
        "--ol-fg:#f1f5f9",
        "--ol-border:#334155",
        "--ol-accent:#60a5fa",
    ] {
        assert!(out.contains(t), "falta el rol {t}: {out}");
    }
    // Y TODO lo demás, tal cual — incluidos los tokens propios del modelo.
    for t in [
        "--accent-r:96,165,250",
        "--accent-ink:#0f172a",
        "--surface-2:#334155",
        "--fg-muted:#cbd5e1",
        "--fg-faint:#94a3b8",
        "--border-strong:#475569",
        "--warn:#f59e0b",
    ] {
        assert!(out.contains(t), "se perdió {t}: {out}");
    }
}

#[test]
fn roles_are_not_repeated_in_their_raw_form() {
    // Repetirlos crudos pisaría lo que ponga una temática, que escribe --ol-*
    // en la raíz. Sólo pueden salir como --ol-*.
    let html = "<head><style>:root.dark{--bg:#0a0a0a;--fg:#fafafa;--fg-muted:#888888}</style></head>";
    let out = normalize_color_modes(html);
    let bloque = out
        .split("data-ol-modes")
        .nth(1)
        .expect("tiene que haber bloque");
    assert!(!bloque.contains("--bg:#0a0a0a"), "--bg crudo no: {bloque}");
    assert!(!bloque.contains("--fg:#fafafa"), "--fg crudo no: {bloque}");
    assert!(
        bloque.contains("--fg-muted:#888888"),
        "--fg-muted sí, que no es rol: {bloque}"
    );
}

#[test]
fn keeps_the_case_the_model_used() {
    // Las custom properties de CSS distinguen mayúsculas.
    let html = "<head><style>:root.dark{--bg:#000000;--fgMuted:#cccccc}</style></head>";
    let out = normalize_color_modes(html);
    assert!(out.contains("--fgMuted:#cccccc"), "{out}");
}
