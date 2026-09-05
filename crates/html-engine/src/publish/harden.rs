// Quality S1 post-processor — a WARNING SCANNER over the AI-output path
// (lib/ai-stream/generate.ts). It does not touch the document: the HTML it
// returns is the HTML it was handed.
//
// Two detections, both in "log + leave intact" mode:
//
//   1. Banned phrases + generic CTAs — a `HardenWarning` per match, so the
//      caller can decide whether to regenerate. Copy text is never rewritten.
//
//   2. Copied sections (Quality S2) — a generated `<section>` that near-exactly
//      echoes the curated corpus. Soft signal; see the block below it.
//
// ⚰️ AQUÍ SE DESCRIBÍAN DOS REESCRITURAS —el tope de alfa en los bordes y la
// normalización de `border-white/20` a `/5`— como si siguieran vivas. Se
// retiraron el 2026-08-26 y la cabecera no se enteró: siguió anunciando «two
// operations» durante diez días sobre una función que ya sólo mira.
//
// El porqué de aquella retirada está UNA vez, en la lápida dentro de
// `harden_visual_quality`. No se repite aquí — una verdad contada en dos sitios
// es una que se puede quedar a medias, y ésta ya se quedó.
//
// Ambas detecciones son regex de una pasada sobre el documento; no se parsea
// nada. lol-html se consideró y no hace falta para buscar texto.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;

// ─── Copy-detection (Quality S2) ─────────────────────────────────────────────
//
// Soft signal — NEVER rewrites or blocks. The vision reference can tempt the
// model to reproduce a template's section copy verbatim; if 3+ generated
// <section>s near-exactly match the curated corpus, we emit warnings so the
// tester (or a future critic loop) can decide. We do NOT auto-rewrite: the
// false-positive risk on legit short hero copy ("Build faster") is too high.
//
// Corpus = distinctive section copy from the three in-repo starter templates
// (Mirror / Manuscript / Counter). The spec asked for the "top 5"; only these
// three ship in the repo (templates/starter/), and Mirror is the canonical
// reference the selector falls back to — so they're exactly the copy most at
// risk of being echoed. Refresh by hand if the starters change.

/// Character-trigram overlap coefficient above which a section counts as a
/// near-verbatim copy of a corpus entry.
const COPY_TRIGRAM_OVERLAP_THRESHOLD: f64 = 0.9;
/// Only warn when at least this many sections match — one coincidental match
/// shouldn't fire.
const COPY_MIN_MATCHED_SECTIONS: usize = 3;
/// We compare the first N chars of each section's flattened text.
const COPY_SECTION_TEXT_LEN: usize = 200;

const COPY_CORPUS: &[&str] = &[
    // Mirror — AI eval / guardrails devtool.
    "every guardrail your safety team would have written by hand.",
    "promote evals to production guardrails.",
    "pay for evaluations. not seats.",
    "engineers who can't afford a 2am model surprise.",
    "frequently asked, honestly answered.",
    "stop fearing the model. trust the policy.",
    // Manuscript — editorial writing tool.
    "an editor that disappears.",
    "numbers, when you actually want them.",
    "your list is yours. we mean it.",
    "what manuscript isn't.",
    "curated. not tiered.",
    "things sensible people ask before signing up.",
    "write the issue that took you six drafts to get right.",
    // Counter — café / point-of-sale.
    "built around the morning rush, not the spreadsheet.",
    "four pieces. one quiet shop floor.",
    "flat monthly. no per-transaction surcharge.",
    "sun cafe cut their morning rush by 38% in one quarter.",
    "plays nicely with the tools you already pay for.",
    "questions our shop owners ask before signing.",
    "ring up your first oat latte in 14 days.",
];

// ⚰️ AQUÍ SE DESCRIBÍA EL TOPE DE ALFA DE LOS BORDES, que reescribía
// `border-white/20` a `/5` para casar con el registro de las plantillas. La
// etapa se RETIRÓ el 2026-08-26 con el resto de «dejamos de re-decidir el
// diseño del modelo»: estaba escrita como «arreglar lo que el modelo hace mal»,
// o sea corregirle el gusto en silencio.
//
// El comentario sobrevivió a su función y se quedó suelto —`///` sin nada
// debajo—, que es lo que clippy caza. Es la misma familia que los tests de
// `normalize_accent`/`normalize_font`: aquella retirada dejó restos por varios
// sitios y nadie los vio porque ninguna puerta de npm corre Rust.

/// Banned phrases from the BANNED ANTI-PATTERNS section of design-guidance.
/// Detection only — we never rewrite copy text in the post-processor, only
/// surface a warning so the caller (or a future critic loop) can decide.
const BANNED_PHRASES: &[&str] = &[
    "Streamline your workflow",
    "Empower your team",
    "Built for the future",
    "supercharge",
    "revolutionary",
    "game-changing",
    "cutting-edge",
    "world-class",
    "The future of",
    "reimagined",
];

const GENERIC_CTAS: &[&str] = &[
    "Learn more →",
    "Learn more &rarr;",
    "Click here",
    "Get started today",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WarningKind {
    BannedPhrase,
    GenericCta,
    /// A generated <section> closely matches curated template copy — possible
    /// verbatim copying of the vision reference. Signal only; not a gate.
    CopiedSection,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HardenWarning {
    pub kind: WarningKind,
    pub matched: String,
}

/// ⚠️ CUATRO CEROS. Los contadores de las dos etapas que reescribían, retiradas
/// el 2026-08-26: `harden_visual_quality` devuelve `HardenCounts::default()` y
/// no hay otro escritor. Su único lector en TS se retiró el 2026-09-05, así que
/// hoy el struct sólo viaja por el napi y nadie lo mira.
///
/// Sigue aquí porque quitarlo cambia el objeto que cruza el binding y obliga a
/// recompilar el `.node`. Que se borre es una decisión, no una limpieza — pero
/// que se lea como una medida viva no lo era.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HardenCounts {
    pub white_alpha_capped: u32,
    pub black_alpha_capped: u32,
    pub tailwind_white_normalized: u32,
    pub tailwind_black_normalized: u32,
}

#[derive(Debug, Clone)]
pub struct HardenResult {
    pub html: String,
    pub counts: HardenCounts,
    pub warnings: Vec<HardenWarning>,
}

// ─── Regexes ────────────────────────────────────────────────────────────────

// Copy-detection: pull each <section>…</section>, then flatten its inner HTML
// to text. Non-greedy + dotall; nested <section> is vanishingly rare in
// generated marketing pages and a non-greedy match is fine for first-N-char
// text extraction.
static SECTION_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<section\b[^>]*>(.*?)</section>").expect("valid section regex"));

static TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<[^>]*>").expect("valid tag-strip regex"));

static WS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").expect("valid whitespace regex"));

// ─── Public entrypoint ──────────────────────────────────────────────────────

/// Scan the document for quality warnings. This pass does NOT rewrite.
///
/// The returned `html` is the input, unchanged — idempotent by construction,
/// not by care. `counts` has been all-zeroes since the two rewriting stages
/// were retired (tombstone below); its only TS reader was dropped on
/// 2026-09-05, so nothing downstream reads it any more.
pub fn harden_visual_quality(html: &str) -> HardenResult {
    // LAS DOS ETAPAS QUE REESCRIBÍAN SE RETIRARON el 2026-08-26.
    //
    // `cap_border_alphas` bajaba a 0.06 cualquier `rgba(255,255,255, X)` de un
    // borde, y `normalize_tailwind_borders` convertía `border-white/20` en
    // `border-white/5`. Las dos estaban escritas como «arreglar lo que Gemini
    // hace mal» — o sea, corregirle el gusto al modelo por debajo, en silencio.
    // Eso es exactamente lo que este trabajo vino a quitar: podemos optimizar,
    // no re-decidir.
    //
    // LO QUE SE QUEDA no toca el documento: los avisos. Las frases prohibidas y
    // la detección de secciones copiadas de las plantillas curadas ya corrían en
    // modo «anota y deja intacto», y siguen ahí — una señal para quien mire, no
    // una mano sobre el diseño.
    let mut warnings = scan_warnings(html);
    warnings.extend(scan_copied_sections(html));

    HardenResult {
        html: html.to_string(),
        counts: HardenCounts::default(),
        warnings,
    }
}

// ─── Detección 1: frases prohibidas + CTAs genéricas ────────────────────────

fn scan_warnings(html: &str) -> Vec<HardenWarning> {
    let mut out = Vec::new();
    for phrase in BANNED_PHRASES {
        if contains_case_insensitive(html, phrase) {
            out.push(HardenWarning {
                kind: WarningKind::BannedPhrase,
                matched: phrase.to_string(),
            });
        }
    }
    for cta in GENERIC_CTAS {
        if contains_case_insensitive(html, cta) {
            out.push(HardenWarning {
                kind: WarningKind::GenericCta,
                matched: cta.to_string(),
            });
        }
    }
    out
}

fn contains_case_insensitive(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let h_lower = haystack.to_ascii_lowercase();
    let n_lower = needle.to_ascii_lowercase();
    h_lower.contains(&n_lower)
}

// ─── Detección 2: secciones copiadas casi literal de las plantillas curadas ──

/// Flatten a section's inner HTML to lowercased, whitespace-collapsed text,
/// truncated to the first [`COPY_SECTION_TEXT_LEN`] chars.
fn normalize_section_text(inner: &str) -> String {
    let no_tags = TAG_RE.replace_all(inner, " ");
    let collapsed = WS_RE.replace_all(no_tags.trim(), " ");
    collapsed
        .to_lowercase()
        .chars()
        .take(COPY_SECTION_TEXT_LEN)
        .collect()
}

fn section_texts(html: &str) -> Vec<String> {
    SECTION_RE
        .captures_iter(html)
        .filter_map(|c| c.get(1))
        .map(|m| normalize_section_text(m.as_str()))
        .filter(|t| !t.is_empty())
        .collect()
}

fn char_trigrams(s: &str) -> HashSet<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut set = HashSet::new();
    if chars.len() < 3 {
        if !chars.is_empty() {
            set.insert(chars.into_iter().collect());
        }
        return set;
    }
    for w in chars.windows(3) {
        set.insert(w.iter().collect());
    }
    set
}

/// Overlap coefficient: |A∩B| / min(|A|,|B|). Using min (not union) means a
/// short corpus phrase fully contained in a longer section scores ~1.0 —
/// exactly the "section reproduces this copy" case we want to catch.
fn overlap_coefficient(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count();
    inter as f64 / a.len().min(b.len()) as f64
}

fn scan_copied_sections(html: &str) -> Vec<HardenWarning> {
    let corpus: Vec<HashSet<String>> = COPY_CORPUS.iter().map(|c| char_trigrams(c)).collect();

    let mut matched: Vec<String> = Vec::new();
    for text in section_texts(html) {
        let tg = char_trigrams(&text);
        let is_copy = corpus
            .iter()
            .any(|ct| overlap_coefficient(ct, &tg) >= COPY_TRIGRAM_OVERLAP_THRESHOLD);
        if is_copy {
            matched.push(text.chars().take(60).collect());
        }
    }

    if matched.len() < COPY_MIN_MATCHED_SECTIONS {
        return Vec::new();
    }
    matched
        .into_iter()
        .map(|m| HardenWarning {
            kind: WarningKind::CopiedSection,
            matched: m,
        })
        .collect()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    // 8 PRUEBAS RETIRADAS el 2026-08-26 con las dos etapas que reescribían: el
    // tope de alfa en los bordes y la normalización de `border-white/20` a `/5`.
    // Medían bien lo que hacían; lo que hacían era corregirle el gusto al modelo
    // por debajo. Lo que queda mide los AVISOS, que no tocan el documento.
    use super::*;

    #[test]
    fn leaves_white_alpha_at_or_below_cap_alone() {
        let input = r#"<style>.x { border-color: rgba(255,255,255,0.06); }</style>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("rgba(255,255,255,0.06)"));
        assert_eq!(result.counts.white_alpha_capped, 0);
    }

    #[test]
    fn leaves_black_alpha_at_cap_alone() {
        let input = r#"<style>.x { border-color: rgba(0,0,0,0.08); }</style>"#;
        let result = harden_visual_quality(input);
        assert_eq!(result.counts.black_alpha_capped, 0);
    }

    #[test]
    fn does_not_cap_rgba_outside_border_context() {
        // Background rgba should be left alone — caps only apply to borders.
        let input = r#"<style>.x { background: rgba(255,255,255,0.40); }</style>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("rgba(255,255,255,0.40)"));
        assert_eq!(result.counts.white_alpha_capped, 0);
    }

    #[test]
    fn does_not_cap_text_color_rgba() {
        let input = r#"<style>.x { color: rgba(0,0,0,0.85); }</style>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("rgba(0,0,0,0.85)"));
        assert_eq!(result.counts.black_alpha_capped, 0);
    }

    #[test]
    fn leaves_border_white_5_alone() {
        let input = r#"<div class="border-white/5">x</div>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("border-white/5"));
        assert_eq!(result.counts.tailwind_white_normalized, 0);
    }

    #[test]
    fn flags_banned_phrases_without_rewriting() {
        let input = r#"<h1>Streamline your workflow</h1><p>cutting-edge tech.</p>"#;
        let result = harden_visual_quality(input);
        // No rewriting on banned copy.
        assert!(result.html.contains("Streamline your workflow"));
        assert!(result.html.contains("cutting-edge"));
        assert_eq!(result.warnings.len(), 2);
        assert!(result.warnings.iter().any(|w| {
            w.kind == WarningKind::BannedPhrase && w.matched == "Streamline your workflow"
        }));
        assert!(result
            .warnings
            .iter()
            .any(|w| { w.kind == WarningKind::BannedPhrase && w.matched == "cutting-edge" }));
    }

    #[test]
    fn flags_generic_ctas() {
        let input = r##"<a href="#">Learn more →</a>"##;
        let result = harden_visual_quality(input);
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].kind, WarningKind::GenericCta);
    }

    #[test]
    fn idempotent_on_already_clean_html() {
        let input = r#"<!doctype html><html><head><style>
            .hair { border-color: rgba(255,255,255,0.06); }
            .hair-b { border-color: rgba(0,0,0,0.08); }
        </style></head><body>
            <div class="border-white/5 border-black/5">ok</div>
        </body></html>"#;
        let pass1 = harden_visual_quality(input);
        let pass2 = harden_visual_quality(&pass1.html);
        assert_eq!(pass1.html, pass2.html);
        assert_eq!(pass1.counts.white_alpha_capped, 0);
        assert_eq!(pass2.counts.white_alpha_capped, 0);
    }

    #[test]
    fn idempotent_after_a_rewrite() {
        let input = r#"<style>.x { border-color: rgba(255,255,255,0.40); }</style>"#;
        let pass1 = harden_visual_quality(input);
        let pass2 = harden_visual_quality(&pass1.html);
        assert_eq!(pass1.html, pass2.html);
        assert_eq!(pass2.counts.white_alpha_capped, 0);
    }

    #[test]
    fn case_insensitive_phrase_matching() {
        let input = r#"<h1>STREAMLINE YOUR WORKFLOW</h1>"#;
        let result = harden_visual_quality(input);
        assert!(result
            .warnings
            .iter()
            .any(|w| { w.matched.eq_ignore_ascii_case("Streamline your workflow") }));
    }

    #[test]
    fn empty_html_is_a_noop() {
        let result = harden_visual_quality("");
        assert_eq!(result.html, "");
        assert_eq!(result.counts, HardenCounts::default());
        assert!(result.warnings.is_empty());
    }

    // ─── Copy-detection (Quality S2) ─────────────────────────────────────────

    fn copy_warnings(result: &HardenResult) -> usize {
        result
            .warnings
            .iter()
            .filter(|w| w.kind == WarningKind::CopiedSection)
            .count()
    }

    #[test]
    fn flags_three_sections_copied_verbatim_from_corpus() {
        let input = concat!(
            r#"<section><h2>An editor that disappears.</h2></section>"#,
            r#"<section><h2>Curated. Not tiered.</h2></section>"#,
            r#"<section><h2>Ring up your first oat latte in 14 days.</h2></section>"#,
        );
        let result = harden_visual_quality(input);
        assert_eq!(copy_warnings(&result), 3);
        // Signal only — never rewrites copy.
        assert_eq!(result.html, input);
    }

    #[test]
    fn does_not_flag_when_fewer_than_three_sections_match() {
        let input = concat!(
            r#"<section><h2>An editor that disappears.</h2></section>"#,
            r#"<section><h2>Curated. Not tiered.</h2></section>"#,
        );
        let result = harden_visual_quality(input);
        assert_eq!(copy_warnings(&result), 0);
    }

    #[test]
    fn does_not_flag_original_section_copy() {
        let input = concat!(
            r#"<section><h2>Track every shipment from one calm dashboard.</h2></section>"#,
            r#"<section><h2>Your warehouse, finally in sync.</h2></section>"#,
            r#"<section><h2>Simple pricing that grows with your pallet volume.</h2></section>"#,
        );
        let result = harden_visual_quality(input);
        assert_eq!(copy_warnings(&result), 0);
    }

    #[test]
    fn copy_detection_does_not_rewrite_and_is_idempotent() {
        let input = concat!(
            r#"<section><h2>An editor that disappears.</h2></section>"#,
            r#"<section><h2>Curated. Not tiered.</h2></section>"#,
            r#"<section><h2>Ring up your first oat latte in 14 days.</h2></section>"#,
        );
        let pass1 = harden_visual_quality(input);
        let pass2 = harden_visual_quality(&pass1.html);
        assert_eq!(pass1.html, input);
        assert_eq!(pass1.html, pass2.html);
        assert_eq!(pass1.warnings.len(), pass2.warnings.len());
    }

    #[test]
    fn copy_detection_ignores_html_without_sections() {
        // Banned-phrase tests use section-free HTML — confirm copy-detection
        // adds nothing there so those counts stay exact.
        let input = r#"<h1>An editor that disappears.</h1>"#;
        let result = harden_visual_quality(input);
        assert_eq!(copy_warnings(&result), 0);
    }
}
