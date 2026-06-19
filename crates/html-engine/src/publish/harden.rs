// Quality S1 post-processor — surgical fixes for the specific anti-patterns
// Gemini ships out of the box that the curated Opus 4.7 templates never have.
//
// Scope is deliberately narrow: this is a safety net for the AI-output path
// (lib/ai-stream/generate.ts), not a general HTML rewriter. Two operations:
//
//   1. Border alpha cap — `border-color: rgba(255,255,255, X)` with X > 0.06
//      gets rewritten to 0.06; same for `rgba(0,0,0, X > 0.08)` → 0.08. Cap
//      also applies inside the `border` / `border-top|right|bottom|left`
//      shorthand. Anywhere else (background, shadow, text color) the rgba is
//      left alone — only border properties are affected.
//
//   2. Tailwind border class normalize — `border-white/10|20|30|40|50` and
//      `border-black/10|20|30|40|50` get rewritten to `/5`. Mirrors the
//      curated templates which only ever use `/5`-equivalent hairlines.
//
// Banned-phrase detection is a third operation but it does NOT rewrite the
// HTML — it just emits a `HardenWarning` per match so the caller can decide
// whether to regenerate. Quality S1 ships in "log + leave intact" mode.
//
// All three operations run via single-pass regex on the document. lol-html
// was considered but the rewrites all happen inside attribute strings and
// `<style>` text content — regex is faster and clearer here, and the rest
// of the publish pipeline is already mixed regex/lol-html/kuchikiki.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::{Captures, Regex};

const MAX_ALPHA_WHITE: f64 = 0.06;
const MAX_ALPHA_BLACK: f64 = 0.08;

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

/// Tailwind border alpha steps over 5 (= 0.05 ≈ hairline) that we cap. We
/// rewrite to `5` to match the canonical templates' `border-white/5` /
/// `border-black/5` register.
const TAILWIND_OVER_CAP: &[&str] = &["10", "20", "25", "30", "40", "50", "60", "70", "80", "90"];

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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HardenCounts {
    /// rgba(255,255,255,…) declarations rewritten to a 0.06 alpha cap.
    pub white_alpha_capped: u32,
    /// rgba(0,0,0,…) declarations rewritten to a 0.08 alpha cap.
    pub black_alpha_capped: u32,
    /// Tailwind `border-white/X` (X > 5) instances normalised to `/5`.
    pub tailwind_white_normalized: u32,
    /// Tailwind `border-black/X` (X > 5) instances normalised to `/5`.
    pub tailwind_black_normalized: u32,
}

#[derive(Debug, Clone)]
pub struct HardenResult {
    pub html: String,
    pub counts: HardenCounts,
    pub warnings: Vec<HardenWarning>,
}

// ─── Regexes ────────────────────────────────────────────────────────────────

// Matches a `border…: <value>` declaration up to (but not including) the
// terminating `;` or `}` or end-of-string. Captures the property name and the
// value separately so the value can be rewritten in place.
//
// Covers: `border:`, `border-color:`, `border-top:`, `border-top-color:`,
//         `border-right:`, `border-bottom:`, `border-left:` and the `-color`
//         variants of all four sides.
static BORDER_DECL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?ix)
        \b(border(?:-(?:top|right|bottom|left))?(?:-color)?)
        \s*:\s*
        ([^;{}\n]+)
        ",
    )
    .expect("valid border declaration regex")
});

// Matches an rgba(...) literal with white channels and a captured alpha. The
// alpha may be `0.xx`, `.xx`, `1`, `1.0`, etc.
static RGBA_WHITE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?ix)
        rgba\(
            \s* 255 \s* , \s* 255 \s* , \s* 255 \s* ,
            \s* (0?\.\d+ | 1(?:\.0+)? )
            \s*
        \)
        ",
    )
    .expect("valid rgba white regex")
});

static RGBA_BLACK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?ix)
        rgba\(
            \s* 0 \s* , \s* 0 \s* , \s* 0 \s* ,
            \s* (0?\.\d+ | 1(?:\.0+)? )
            \s*
        \)
        ",
    )
    .expect("valid rgba black regex")
});

// Tailwind `border-white/X` / `border-black/X` utilities. We only rewrite
// when X is one of the over-cap steps. `\b` boundaries keep this from
// matching things like `border-white/5-foo` if such a class ever existed.
static TW_WHITE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bborder-white/(\d{1,3})\b").expect("valid tailwind white regex"));

static TW_BLACK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bborder-black/(\d{1,3})\b").expect("valid tailwind black regex"));

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

/// Apply the Quality S1 visual-quality hardening pass.
///
/// Returns the rewritten HTML, the counts of each operation, and any
/// warnings about banned phrases or generic CTAs detected. Idempotent: a
/// second call on the same input is a no-op (caps + Tailwind normalisations
/// already match; warnings repeat).
pub fn harden_visual_quality(html: &str) -> HardenResult {
    let mut counts = HardenCounts::default();

    let stage1 = cap_border_alphas(html, &mut counts);
    let stage2 = normalize_tailwind_borders(&stage1, &mut counts);
    let mut warnings = scan_warnings(&stage2);
    warnings.extend(scan_copied_sections(&stage2));

    HardenResult {
        html: stage2,
        counts,
        warnings,
    }
}

// ─── Stage 1: cap rgba alphas in border declarations ────────────────────────

fn cap_border_alphas(html: &str, counts: &mut HardenCounts) -> String {
    BORDER_DECL_RE
        .replace_all(html, |caps: &Captures| {
            let prop = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let value = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            let mut new_value = value.to_string();

            new_value = RGBA_WHITE_RE
                .replace_all(&new_value, |c: &Captures| {
                    let alpha_str = c.get(1).map(|m| m.as_str()).unwrap_or("0");
                    let alpha = alpha_str.parse::<f64>().unwrap_or(0.0);
                    if alpha > MAX_ALPHA_WHITE {
                        counts.white_alpha_capped += 1;
                        format!("rgba(255,255,255,{})", format_alpha(MAX_ALPHA_WHITE))
                    } else {
                        c.get(0).unwrap().as_str().to_string()
                    }
                })
                .into_owned();

            new_value = RGBA_BLACK_RE
                .replace_all(&new_value, |c: &Captures| {
                    let alpha_str = c.get(1).map(|m| m.as_str()).unwrap_or("0");
                    let alpha = alpha_str.parse::<f64>().unwrap_or(0.0);
                    if alpha > MAX_ALPHA_BLACK {
                        counts.black_alpha_capped += 1;
                        format!("rgba(0,0,0,{})", format_alpha(MAX_ALPHA_BLACK))
                    } else {
                        c.get(0).unwrap().as_str().to_string()
                    }
                })
                .into_owned();

            format!("{}: {}", prop, new_value.trim_start())
        })
        .into_owned()
}

fn format_alpha(a: f64) -> String {
    // Strip trailing zeros so `0.06` reads as `0.06` not `0.06000`.
    let s = format!("{:.2}", a);
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

// ─── Stage 2: normalize Tailwind border-white|black/{>5} → /5 ───────────────

fn normalize_tailwind_borders(html: &str, counts: &mut HardenCounts) -> String {
    let after_white = TW_WHITE_RE.replace_all(html, |c: &Captures| {
        let step = c.get(1).map(|m| m.as_str()).unwrap_or("");
        if TAILWIND_OVER_CAP.contains(&step) {
            counts.tailwind_white_normalized += 1;
            "border-white/5".to_string()
        } else {
            c.get(0).unwrap().as_str().to_string()
        }
    });

    TW_BLACK_RE
        .replace_all(&after_white, |c: &Captures| {
            let step = c.get(1).map(|m| m.as_str()).unwrap_or("");
            if TAILWIND_OVER_CAP.contains(&step) {
                counts.tailwind_black_normalized += 1;
                "border-black/5".to_string()
            } else {
                c.get(0).unwrap().as_str().to_string()
            }
        })
        .into_owned()
}

// ─── Stage 3: detect banned phrases + generic CTAs ──────────────────────────

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

// ─── Stage 4: detect sections copied near-verbatim from curated templates ────

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
    use super::*;

    #[test]
    fn caps_white_alpha_in_border_color() {
        let input = r#"<div style="border-color: rgba(255,255,255,0.40)">x</div>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("rgba(255,255,255,0.06)"));
        assert!(!result.html.contains("0.40"));
        assert_eq!(result.counts.white_alpha_capped, 1);
    }

    #[test]
    fn caps_white_alpha_in_border_shorthand() {
        let input = r#"<div style="border: 1px solid rgba(255,255,255,0.50)">x</div>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("rgba(255,255,255,0.06)"));
        assert_eq!(result.counts.white_alpha_capped, 1);
    }

    #[test]
    fn caps_white_alpha_inside_style_block() {
        let input = r#"<style>
            .x { border-color: rgba(255,255,255, 0.30); }
            .y { border-top: 1px solid rgba(255, 255, 255, 0.25); }
        </style>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("rgba(255,255,255,0.06)"));
        assert_eq!(result.counts.white_alpha_capped, 2);
    }

    #[test]
    fn leaves_white_alpha_at_or_below_cap_alone() {
        let input = r#"<style>.x { border-color: rgba(255,255,255,0.06); }</style>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("rgba(255,255,255,0.06)"));
        assert_eq!(result.counts.white_alpha_capped, 0);
    }

    #[test]
    fn caps_black_alpha_to_higher_threshold() {
        let input = r#"<style>.x { border-color: rgba(0,0,0,0.20); }</style>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("rgba(0,0,0,0.08)"));
        assert_eq!(result.counts.black_alpha_capped, 1);
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
    fn normalizes_border_white_class() {
        let input = r#"<div class="border-white/40 p-4">x</div>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("border-white/5"));
        assert!(!result.html.contains("border-white/40"));
        assert_eq!(result.counts.tailwind_white_normalized, 1);
    }

    #[test]
    fn normalizes_border_black_class() {
        let input = r#"<div class="border-black/20">x</div>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("border-black/5"));
        assert_eq!(result.counts.tailwind_black_normalized, 1);
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
    fn handles_multiple_border_decls_in_one_rule() {
        let input = r#"<style>
            .x {
                border-top: 1px solid rgba(255,255,255,0.30);
                border-bottom: 1px solid rgba(255,255,255,0.20);
                background: rgba(255,255,255,0.5);
            }
        </style>"#;
        let result = harden_visual_quality(input);
        assert_eq!(result.counts.white_alpha_capped, 2);
        // Background untouched.
        assert!(result.html.contains("background: rgba(255,255,255,0.5)"));
    }

    #[test]
    fn preserves_neighbouring_declarations() {
        let input = r#"<div style="padding: 4px; border-color: rgba(255,255,255,0.40); color: red;">x</div>"#;
        let result = harden_visual_quality(input);
        assert!(result.html.contains("padding: 4px"));
        assert!(result.html.contains("color: red"));
        assert!(result.html.contains("rgba(255,255,255,0.06)"));
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
