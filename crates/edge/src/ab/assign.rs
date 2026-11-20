//! Deterministic traffic assignment + sticky cookie handling.
//!
//! Parity contract with TypeScript `lib/ab/serve.ts`:
//!   SHA-256("{salt}:{exp_id}:{client_ip}:{ua}:{accept_lang}")
//!   bucket = u32::from_be_bytes(digest[0..4]) % 10_000
//!   variant = if bucket < split_bps { B } else { A }

use std::path::{Component, Path};

use chrono::{DateTime, Utc};
use percent_encoding::percent_decode_str;
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

/// The segments of the path the file resolver would walk: percent-decoded once (like
/// `files::resolve`), `\` as a separator, empty and `.` segments dropped, `..` popping its
/// parent, a NUL cutting its segment, and lower-cased (the filesystem may not care about case).
fn resolved_segments(url_path: &str) -> Vec<String> {
    let decoded = percent_decode_str(url_path).decode_utf8_lossy();
    let mut out: Vec<String> = Vec::new();
    for seg in decoded.split(['/', '\\']) {
        let seg = seg.split('\0').next().unwrap_or("");
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            other => out.push(other.to_ascii_lowercase()),
        }
    }
    out
}

/// True if `url_path` addresses the experiment's own files once it is RESOLVED (decoded,
/// dot segments removed, trailing and doubled slashes gone): `/openlen/ab.json` or
/// `/openlen/ab` / `/openlen/ab/*`. The edge must ALWAYS return 404 for these. Other files of
/// the reserved `openlen/` root (e.g. the bubble's `figure-<sha>.js`) are served as usual.
pub fn is_blocked_internal_path(url_path: &str) -> bool {
    let segs = resolved_segments(url_path);
    segs.len() >= 2 && segs[0] == "openlen" && (segs[1] == "ab.json" || segs[1] == "ab")
}

/// True when `file` (canonical) is the experiment manifest or lives under the experiment's
/// own tree, inside the canonical release dir `release_root`.
pub fn is_internal_ab_file(release_root: &Path, file: &Path) -> bool {
    let Ok(rel) = file.strip_prefix(release_root) else {
        return false;
    };
    let mut parts = rel.components().filter_map(|c| match c {
        Component::Normal(p) => p.to_str(),
        _ => None,
    });
    let (Some(first), Some(second)) = (parts.next(), parts.next()) else {
        return false;
    };
    first.eq_ignore_ascii_case("openlen")
        && (second.eq_ignore_ascii_case("ab.json") || second.eq_ignore_ascii_case("ab"))
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

/// `application/x-www-form-urlencoded` decoding of one key or value (`+` is a space, `%XX` bytes,
/// invalid UTF-8 replaced): what `URLSearchParams` does in `lib/ab/serve.ts`.
fn decode_form_component(raw: &str) -> String {
    let spaced = raw.replace('+', " ");
    percent_decode_str(&spaced).decode_utf8_lossy().into_owned()
}

/// Parse a named query parameter from a raw query string (without leading `?`), decoded like
/// `URLSearchParams.get`: keys and values are form-decoded, the FIRST occurrence wins, a key
/// without `=` is present with an empty value, empty parts (`&&`) are skipped.
pub fn read_query_param(query: Option<&str>, name: &str) -> Option<String> {
    let raw = query?;
    for part in raw.split('&') {
        if part.is_empty() {
            continue;
        }
        let (k, v) = part.split_once('=').unwrap_or((part, ""));
        if decode_form_component(k) == name {
            return Some(decode_form_component(v));
        }
    }
    None
}

/// The resolved URL path, case kept: percent-decoded once, `\` and `/` as separators, empty and `.`
/// segments dropped, `..` popping its parent, a NUL cutting its segment; always with a leading `/`,
/// never a trailing one. The path every decision is made on, in `lib/ab/serve.ts` too.
pub fn canonical_path(url_path: &str) -> String {
    let decoded = percent_decode_str(url_path).decode_utf8_lossy();
    let mut out: Vec<&str> = Vec::new();
    for seg in decoded.split(['/', '\\']) {
        let seg = seg.split('\0').next().unwrap_or("");
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    format!("/{}", out.join("/"))
}

/// True for a path whose last segment has an extension other than `.html`/`.htm`: a file, not a
/// page. A dotfile (`/.well-known/x`, `/.hidden`) is a file too.
pub fn is_asset_path(url_path: &str) -> bool {
    path_has_non_html_extension(&canonical_path(url_path))
}

/// Bucket (0..10_000) of a visitor, identical to TypeScript `hashBucket`.
pub fn hash_bucket(
    salt: &str,
    exp_id: &str,
    client_ip: &str,
    user_agent: &str,
    accept_language: &str,
) -> u16 {
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
    // u32, not u16: 65_536 is not a multiple of 10_000, so a u16 would favour buckets
    // 0..5_535 and send 53.4 % of a 50/50 to B (the bias of a u32 is 2e-6).
    (u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 10_000) as u16
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
    if hash_bucket(salt, exp_id, client_ip, user_agent, accept_language) < split_bps {
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
/// Returns `None` when the request is outside every active experiment (so the caller serves
/// control with its standard headers untouched). `url_path` may be raw: it is resolved first.
///
/// A PAGE of an experiment is bucketed (override, bot, sticky cookie, hash). A FILE is decided
/// only when the manifest lists it in `overrides` — B ships different bytes for it — and then for
/// EVERY visitor, control included: the caller marks the answer `no-store`, or Cloudflare would
/// cache one variant's bytes under the shared URL for the other's visitors.
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
    let path = canonical_path(url_path);

    if path_has_non_html_extension(&path) {
        if !manifest.overrides_file(&path) {
            return None;
        }
        let exp = manifest.experiments.iter().find(|e| !e.is_expired(now))?;
        let ov = read_query_param(query, &exp.override_param).map(|v| v.to_ascii_lowercase());
        let cv = read_cookie(cookie_header, &exp.cookie_name).map(str::to_ascii_lowercase);
        let (variant, source) = match (ov.as_deref(), cv.as_deref()) {
            (Some("b"), _) => (Variant::B, AssignSource::Override),
            (Some("a"), _) => (Variant::A, AssignSource::Override),
            (_, Some("b")) => (Variant::B, AssignSource::Cookie),
            _ => (Variant::A, AssignSource::Cookie),
        };
        return Some(AbDecision {
            experiment_id: exp.id.clone(),
            variant,
            source,
            variant_b_path: (variant == Variant::B)
                .then(|| build_variant_b_url(&exp.prefix_b, &path)),
            set_cookie: None,
            is_override: source == AssignSource::Override,
            is_page_route: false,
        });
    }

    let normalized = normalize_match_path(&path);
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
            overrides: Vec::new(),
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
    fn blocks_the_internal_files_on_the_resolved_path_not_the_raw_one() {
        // The filter used to look at the raw path: each of these reaches the manifest or
        // Variant B's tree after the file resolver decodes and normalizes it.
        for path in [
            "/openlen/ab.json/",
            "/openlen/%61b.json",
            "/openlen/%61B.JSON",
            "/openlen/./ab.json",
            "/openlen//ab.json",
            "//openlen/ab.json",
            "/foo/../openlen/ab.json",
            "/openlen/ab%2Ejson",
            "/openlen%2Fab.json",
            "/openlen/ab/",
            "/openlen/%61b",
            "/openlen/%61b/ab_9f3c2a1b/b/index.html",
            "/openlen/./ab/ab_9f3c2a1b/b/index.html",
            "/OpEnLeN/Ab/ab_9f3c2a1b/b/index.html",
            "/openlen/ab/../ab/x",
            r"/openlen\ab.json",
            "/openlen/ab.json%00.png",
        ] {
            assert!(is_blocked_internal_path(path), "{path} must be blocked");
        }
        for path in [
            "/",
            "/about",
            "/abc.json",
            "/openlen",
            "/openlen/",
            "/openlen/abc",
            "/openlen/ab.jsonx",
            "/openlen/ab.json.map",
            "/openlen/figure-0a1b2c3d.js",
            "/x/openlen/ab.json",
            "/openlen/../about",
            "/ab/openlen/ab.json",
        ] {
            assert!(!is_blocked_internal_path(path), "{path} must NOT be blocked");
        }
    }

    #[test]
    fn a_resolved_file_is_internal_only_inside_this_releases_openlen_ab() {
        let dir = tempfile::TempDir::new().unwrap();
        let release = dir.path().join("releases").join("aaaa11112222");
        std::fs::create_dir_all(release.join("openlen/ab/ab_1/b")).unwrap();
        std::fs::write(release.join("openlen/ab.json"), "{}").unwrap();
        std::fs::write(release.join("openlen/ab/ab_1/b/index.html"), "b").unwrap();
        std::fs::write(release.join("openlen/figure-0a1b2c3d.js"), "f").unwrap();
        std::fs::write(release.join("index.html"), "a").unwrap();
        let root = release.canonicalize().unwrap();
        let file = |rel: &str| release.join(rel).canonicalize().unwrap();
        assert!(is_internal_ab_file(&root, &file("openlen/ab.json")));
        assert!(is_internal_ab_file(&root, &file("openlen/ab/ab_1/b/index.html")));
        assert!(!is_internal_ab_file(&root, &file("openlen/figure-0a1b2c3d.js")));
        assert!(!is_internal_ab_file(&root, &file("index.html")));
        // A site that is itself called `ab` (publish root /…/openlen/ab/…) is not blocked.
        let nested = dir.path().join("openlen").join("ab").join("current");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("index.html"), "x").unwrap();
        let nested_root = nested.canonicalize().unwrap();
        assert!(!is_internal_ab_file(&nested_root, &nested.join("index.html").canonicalize().unwrap()));
    }

    /// Deterministic visitors: 200k distinct IPs, one browser. Same generator as the TS test.
    fn sample_bucket(i: u32) -> u16 {
        let ip = format!("10.{}.{}.{}", (i >> 16) & 255, (i >> 8) & 255, i & 255);
        hash_bucket("3f9a1c8e7b2d4012", "ab_9f3c2a1b", &ip, "UA", "en")
    }

    #[test]
    fn buckets_are_uniform_so_every_split_gets_its_share() {
        // The bucket is the first 4 bytes as a u32 modulo 10_000 (bias: 2e-6). A u16 modulo
        // 10_000 (the first version) sent 53.4 % of a 50/50 to B and tripped the sample-ratio
        // guard at ~2,300 visits; 200k visitors pin the exact expectation instead of a lucky band.
        const N: u32 = 200_000;
        let buckets: Vec<u16> = (0..N).map(sample_bucket).collect();
        for split in [1000u32, 2500, 5000, 7500, 9000] {
            let in_b = buckets.iter().filter(|b| u32::from(**b) < split).count() as f64;
            let share = in_b / f64::from(N);
            let expected = f64::from(split) / 10_000.0;
            assert!(
                (share - expected).abs() <= 0.005,
                "split {split}: expected {expected} +/- 0.005 of {N} visitors, got {share}"
            );
        }
    }

    #[test]
    fn hash_variant_applies_the_bucket_to_the_split() {
        let b = hash_bucket("s", "ab_12345678", "1.2.3.4", "UA", "en");
        assert_eq!(hash_variant("s", "ab_12345678", "1.2.3.4", "UA", "en", b), Variant::A);
        assert_eq!(hash_variant("s", "ab_12345678", "1.2.3.4", "UA", "en", b + 1), Variant::B);
        assert_eq!(hash_variant("s", "ab_12345678", "1.2.3.4", "UA", "en", 0), Variant::A);
        assert_eq!(hash_variant("s", "ab_12345678", "1.2.3.4", "UA", "en", 10_000), Variant::B);
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
        // Golden vectors shared with `lib/ab/serve.test.ts` (one JSON file, read by both).
        let doc: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/ab/hash-vectors.json"))
                .expect("hash-vectors.json");
        let vectors = doc["vectors"].as_array().expect("vectors");
        assert!(vectors.len() >= 10);
        for v in vectors {
            let s = |k: &str| v[k].as_str().expect(k).to_owned();
            let (salt, exp_id, ip, ua, lang) = (s("salt"), s("expId"), s("ip"), s("ua"), s("lang"));
            let bucket = v["bucket"].as_u64().expect("bucket") as u16;
            assert_eq!(hash_bucket(&salt, &exp_id, &ip, &ua, &lang), bucket, "{v}");
            // A visitor is in B iff bucket < split: the boundary is exact.
            assert_eq!(hash_variant(&salt, &exp_id, &ip, &ua, &lang, bucket), Variant::A, "{v}");
            if bucket < 9_999 {
                assert_eq!(
                    hash_variant(&salt, &exp_id, &ip, &ua, &lang, bucket + 1),
                    Variant::B,
                    "{v}"
                );
            }
        }
    }
}
