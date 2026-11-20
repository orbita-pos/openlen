//! Deterministic traffic assignment + sticky cookie handling.
//!
//! Parity contract with TypeScript `lib/ab/serve.ts`:
//!   SHA-256("{salt}:{exp_id}:{client_ip}:{ua}:{accept_lang}")
//!   bucket = u16::from_be_bytes([digest[0], digest[1]]) % 10_000
//!   variant = if bucket < split_bps { B } else { A }

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};

use super::bot::is_bot;
use super::manifest::{normalize_match_path, AbExperiment, AbManifest};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    A,
    B,
}

impl Variant {
    pub fn as_str(self) -> &'static str {
        match self {
            Variant::A => "a",
            Variant::B => "b",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignSource {
    Cookie,
    Hash,
    Bot,
    Override,
}

impl AssignSource {
    pub fn as_label(self) -> &'static str {
        match self {
            AssignSource::Cookie => "cookie",
            AssignSource::Hash => "hash",
            AssignSource::Bot => "bot",
            AssignSource::Override => "override",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AbDecision {
    pub experiment_id: String,
    pub variant: Variant,
    pub source: AssignSource,
    /// Path to try on disk when serving Variant B (relative to release dir,
    /// starting with `/openlen/ab/<id>/b/...`). `None` when serving Control A.
    pub variant_b_path: Option<String>,
    /// `Set-Cookie` header value when a new sticky assignment was minted.
    pub set_cookie: Option<String>,
    /// True when the request was resolved via `?_ol_ab=a|b` override (adds `X-Robots-Tag: noindex`).
    pub is_override: bool,
    /// True when the matched request is an HTML/page route (must emit `private, no-store` + `Vary: Cookie`).
    pub is_page_route: bool,
}

/// True if `url_path` tries to directly address the experiment's own files:
/// `/openlen/ab.json` or `/openlen/ab` / `/openlen/ab/*`. The edge must ALWAYS return
/// 404 for these. Other files of the reserved `openlen/` root (e.g. the bubble's
/// `figure-<sha>.js`) are served as usual.
pub fn is_blocked_internal_path(url_path: &str) -> bool {
    let trimmed = url_path.trim_start_matches('/');
    let lower = trimmed.to_ascii_lowercase();
    lower == "openlen/ab.json" || lower == "openlen/ab" || lower.starts_with("openlen/ab/")
}

/// Parse a named cookie from a raw `Cookie` header string.
pub fn read_cookie<'a>(cookie_header: Option<&'a str>, name: &str) -> Option<&'a str> {
    let raw = cookie_header?;
    for part in raw.split(';') {
        let part = part.trim();
        let Some((k, v)) = part.split_once('=') else {
            continue;
        };
        if k.trim() == name {
            return Some(v.trim());
        }
    }
    None
}

/// Parse a named query parameter from a raw query string (without leading `?`).
pub fn read_query_param<'a>(query: Option<&'a str>, name: &str) -> Option<&'a str> {
    let raw = query?;
    for part in raw.split('&') {
        let Some((k, v)) = part.split_once('=') else {
            continue;
        };
        if k == name {
            return Some(v);
        }
    }
    None
}

/// Pure deterministic hash assignment identical to TypeScript `hashVariant`.
pub fn hash_variant(
    salt: &str,
    exp_id: &str,
    client_ip: &str,
    user_agent: &str,
    accept_language: &str,
    split_bps: u16,
) -> Variant {
    if split_bps == 0 {
        return Variant::A;
    }
    if split_bps >= 10_000 {
        return Variant::B;
    }
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":");
    hasher.update(exp_id.as_bytes());
    hasher.update(b":");
    hasher.update(client_ip.as_bytes());
    hasher.update(b":");
    hasher.update(user_agent.as_bytes());
    hasher.update(b":");
    hasher.update(accept_language.as_bytes());
    let digest = hasher.finalize();
    let bucket = u16::from_be_bytes([digest[0], digest[1]]) % 10_000;
    if bucket < split_bps {
        Variant::B
    } else {
        Variant::A
    }
}

fn path_has_non_html_extension(url_path: &str) -> bool {
    let trimmed = url_path.trim_matches('/');
    if trimmed.is_empty() {
        return false;
    }
    let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
    let Some((_, ext)) = last.rsplit_once('.') else {
        return false;
    };
    !ext.eq_ignore_ascii_case("html") && !ext.eq_ignore_ascii_case("htm")
}

/// Check if an experiment covers this normalized page path (including locales when enabled).
fn matches_experiment_page(exp: &AbExperiment, normalized_path: &str) -> bool {
    if normalized_path == exp.target_path {
        return true;
    }
    if exp.include_locales && exp.target_path == "/" {
        let seg = normalized_path.trim_start_matches('/');
        if !seg.contains('/') && exp.locales.iter().any(|l| l == seg) {
            return true;
        }
    }
    false
}

/// Build the relative URL path under `<release>/` for Variant B.
fn build_variant_b_url(prefix_b: &str, url_path: &str) -> String {
    let rel = url_path.trim_start_matches('/');
    if rel.is_empty() {
        format!("/{prefix_b}/index.html")
    } else {
        format!("/{prefix_b}/{rel}")
    }
}

/// Evaluate an incoming request against a validated `AbManifest`.
///
/// Returns `None` when the request path is outside every active experiment (so
/// the caller serves Control A with standard CDN cache headers untouched).
#[allow(clippy::too_many_arguments)]
pub fn evaluate_manifest(
    manifest: &AbManifest,
    url_path: &str,
    query: Option<&str>,
    cookie_header: Option<&str>,
    user_agent: &str,
    accept_language: &str,
    client_ip: &str,
    secure_cookie: bool,
    now: DateTime<Utc>,
) -> Option<AbDecision> {
    let is_asset = path_has_non_html_extension(url_path);

    if is_asset {
        // Folder assets (e.g. /css/site.css, /js/app.js) only route to Variant B
        // if the visitor already carries a Variant B sticky cookie (or override)
        // for a live experiment; the caller falls back to Control A if B didn't
        // override that asset.
        for exp in &manifest.experiments {
            if exp.is_expired(now) {
                continue;
            }
            let override_v = read_query_param(query, &exp.override_param);
            let cookie_v = read_cookie(cookie_header, &exp.cookie_name);
            let wants_b = matches!(override_v, Some("b" | "B"))
                || (override_v.is_none() && matches!(cookie_v, Some("b" | "B")));
            if wants_b {
                return Some(AbDecision {
                    experiment_id: exp.id.clone(),
                    variant: Variant::B,
                    source: if override_v.is_some() {
                        AssignSource::Override
                    } else {
                        AssignSource::Cookie
                    },
                    variant_b_path: Some(build_variant_b_url(&exp.prefix_b, url_path)),
                    set_cookie: None,
                    is_override: override_v.is_some(),
                    is_page_route: false,
                });
            }
        }
        return None;
    }

    let normalized = normalize_match_path(url_path);
    let exp = manifest
        .experiments
        .iter()
        .find(|e| !e.is_expired(now) && matches_experiment_page(e, &normalized))?;

    // 1. Explicit QA / preview override `?_ol_ab=a|b` — no cookie, adds noindex.
    if let Some(raw_ov) = read_query_param(query, &exp.override_param) {
        let ov = raw_ov.to_ascii_lowercase();
        if ov == "a" || ov == "b" {
            let variant = if ov == "b" { Variant::B } else { Variant::A };
            return Some(AbDecision {
                experiment_id: exp.id.clone(),
                variant,
                source: AssignSource::Override,
                variant_b_path: (variant == Variant::B)
                    .then(|| build_variant_b_url(&exp.prefix_b, &normalized)),
                set_cookie: None,
                is_override: true,
                is_page_route: true,
            });
        }
    }

    // 2. Bots always receive Control A with zero cookies.
    if is_bot(user_agent) {
        return Some(AbDecision {
            experiment_id: exp.id.clone(),
            variant: Variant::A,
            source: AssignSource::Bot,
            variant_b_path: None,
            set_cookie: None,
            is_override: false,
            is_page_route: true,
        });
    }

    // 3. Existing sticky cookie.
    if let Some(raw_cookie) = read_cookie(cookie_header, &exp.cookie_name) {
        let val = raw_cookie.to_ascii_lowercase();
        if val == "a" || val == "b" {
            let variant = if val == "b" { Variant::B } else { Variant::A };
            return Some(AbDecision {
                experiment_id: exp.id.clone(),
                variant,
                source: AssignSource::Cookie,
                variant_b_path: (variant == Variant::B)
                    .then(|| build_variant_b_url(&exp.prefix_b, &normalized)),
                set_cookie: None,
                is_override: false,
                is_page_route: true,
            });
        }
    }

    // 4. First-visit deterministic assignment + mint sticky cookie (30d, SameSite=Lax).
    let variant = hash_variant(
        &exp.salt,
        &exp.id,
        client_ip,
        user_agent,
        accept_language,
        exp.split_bps,
    );
    let secure_attr = if secure_cookie { "; Secure" } else { "" };
    let set_cookie = format!(
        "{}={}; Path=/; Max-Age=2592000; SameSite=Lax{secure_attr}",
        exp.cookie_name,
        variant.as_str()
    );

    Some(AbDecision {
        experiment_id: exp.id.clone(),
        variant,
        source: AssignSource::Hash,
        variant_b_path: (variant == Variant::B)
            .then(|| build_variant_b_url(&exp.prefix_b, &normalized)),
        set_cookie: Some(set_cookie),
        is_override: false,
        is_page_route: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest() -> AbManifest {
        AbManifest {
            version: 1,
            release_sha: "abc123456789".into(),
            experiments: vec![AbExperiment {
                id: "ab_9f3c2a1b".into(),
                cookie_name: "ol_ab_9f3c2a1b".into(),
                target_path: "/".into(),
                include_locales: true,
                locales: vec!["es".into(), "fr".into()],
                split_bps: 5000,
                salt: "3f9a1c8e7b2d4012".into(),
                prefix_b: "openlen/ab/ab_9f3c2a1b/b".into(),
                override_param: "_ol_ab".into(),
                expires_at: None,
            }],
        }
    }

    #[test]
    fn blocks_internal_ab_paths() {
        assert!(is_blocked_internal_path("/openlen/ab.json"));
        assert!(is_blocked_internal_path("/OPENLEN/AB.JSON"));
        assert!(is_blocked_internal_path("/openlen/ab"));
        assert!(is_blocked_internal_path("/openlen/ab/ab_9f3c2a1b/b/index.html"));
        assert!(!is_blocked_internal_path("/about"));
        assert!(!is_blocked_internal_path("/"));
        // Other files of the reserved `openlen/` root keep being served.
        assert!(!is_blocked_internal_path("/openlen/figure-0a1b2c3d.js"));
        // The pre-move layout is an ordinary path now.
        assert!(!is_blocked_internal_path("/ab.json"));
        assert!(!is_blocked_internal_path("/_ab/x"));
    }

    #[test]
    fn hash_distribution_is_balanced_around_50_50() {
        let mut b_count = 0usize;
        for i in 0..10_000u32 {
            let ip = format!("203.0.{}.{}", (i / 256) % 256, i % 256);
            let v = hash_variant(
                "3f9a1c8e7b2d4012",
                "ab_9f3c2a1b",
                &ip,
                "Mozilla/5.0 Chrome/131.0",
                "es-MX,es;q=0.9",
                5000,
            );
            if v == Variant::B {
                b_count += 1;
            }
        }
        assert!(
            (4700..=5300).contains(&b_count),
            "expected ~5000 B assignments, got {b_count}"
        );
    }

    #[test]
    fn sticky_cookie_override_and_bot_precedence() {
        let m = sample_manifest();
        let now = Utc::now();
        let chrome = "Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36";

        // Bot always gets A, no cookie
        let bot = evaluate_manifest(&m, "/", None, None, "Googlebot/2.1", "en", "1.2.3.4", true, now)
            .expect("matched");
        assert_eq!(bot.variant, Variant::A);
        assert_eq!(bot.source, AssignSource::Bot);
        assert!(bot.set_cookie.is_none());

        // Override wins even over bot/cookie, no cookie set
        let ov = evaluate_manifest(
            &m,
            "/",
            Some("_ol_ab=b"),
            Some("ol_ab_9f3c2a1b=a"),
            "Googlebot/2.1",
            "en",
            "1.2.3.4",
            true,
            now,
        )
        .expect("matched");
        assert_eq!(ov.variant, Variant::B);
        assert_eq!(ov.source, AssignSource::Override);
        assert!(ov.is_override);
        assert!(ov.set_cookie.is_none());
        assert_eq!(
            ov.variant_b_path.as_deref(),
            Some("/openlen/ab/ab_9f3c2a1b/b/index.html")
        );

        // Sticky cookie preserves variant without minting a new cookie
        let sticky = evaluate_manifest(
            &m,
            "/es/",
            None,
            Some("foo=1; ol_ab_9f3c2a1b=b"),
            chrome,
            "es",
            "1.2.3.4",
            true,
            now,
        )
        .expect("locale matched");
        assert_eq!(sticky.variant, Variant::B);
        assert_eq!(sticky.source, AssignSource::Cookie);
        assert!(sticky.set_cookie.is_none());
        assert_eq!(
            sticky.variant_b_path.as_deref(),
            Some("/openlen/ab/ab_9f3c2a1b/b/es")
        );

        // Route outside targetPath returns None
        assert!(
            evaluate_manifest(&m, "/about", None, None, chrome, "en", "1.2.3.4", true, now)
                .is_none()
        );
    }

    #[test]
    fn shared_parity_vectors_match_typescript() {
        // Golden SHA-256 vectors verified bit-for-bit against `lib/ab/serve.test.ts`.
        assert_eq!(
            hash_variant(
                "3f9a1c8e7b2d4012",
                "ab_9f3c2a1b",
                "203.0.113.10",
                "Mozilla/5.0 Chrome/131.0",
                "es-MX,es;q=0.9",
                5000
            ),
            Variant::B
        );
        assert_eq!(
            hash_variant(
                "3f9a1c8e7b2d4012",
                "ab_9f3c2a1b",
                "203.0.113.10",
                "Mozilla/5.0 Chrome/131.0",
                "es-MX,es;q=0.9",
                3785
            ),
            Variant::A
        );
        assert_eq!(
            hash_variant(
                "3f9a1c8e7b2d4012",
                "ab_9f3c2a1b",
                "203.0.113.10",
                "Mozilla/5.0 Chrome/131.0",
                "es-MX,es;q=0.9",
                3786
            ),
            Variant::B
        );
        assert_eq!(
            hash_variant(
                "3f9a1c8e7b2d4012",
                "ab_9f3c2a1b",
                "198.51.100.42",
                "Mozilla/5.0 Safari/605.1",
                "en-US,en;q=0.9",
                5000
            ),
            Variant::A
        );
        assert_eq!(
            hash_variant("salt0", "ab_deadbeef", "10.0.0.1", "UA", "fr", 5000),
            Variant::B
        );
        assert_eq!(
            hash_variant("salt1", "ab_00112233", "192.0.2.5", "UA2", "de", 5000),
            Variant::A
        );
    }
}
