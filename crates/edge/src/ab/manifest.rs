//! Strict parser + validator for `<release>/openlen/ab.json`.
//!
//! Malformed manifests or unknown schema versions fail open (`None`) so a bad
//! manifest can never break live traffic — the edge serves Control A cleanly.

use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Deserialize;

static EXP_ID_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-z0-9][a-z0-9_-]{3,39}$").expect("valid exp id regex"));
static COOKIE_NAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[A-Za-z0-9_-]{4,64}$").expect("valid cookie regex"));
static LOCALE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-z]{2}(?:-[a-z0-9]{2,4})?$").expect("valid locale regex"));

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbManifest {
    pub version: u32,
    #[serde(default)]
    pub release_sha: String,
    #[serde(default)]
    pub experiments: Vec<AbExperiment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbExperiment {
    pub id: String,
    pub cookie_name: String,
    pub target_path: String,
    #[serde(default)]
    pub include_locales: bool,
    #[serde(default)]
    pub locales: Vec<String>,
    /// Basis points (0..=10_000) assigned to Variant B. 5000 = 50/50.
    pub split_bps: u16,
    pub salt: String,
    /// Relative prefix inside `<release>/`, e.g. `openlen/ab/ab_9f3c2a1b/b`. It must live
    /// under the reserved `openlen/ab/` root, so no file of the owner can collide with it.
    pub prefix_b: String,
    #[serde(default = "default_override_param")]
    pub override_param: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

fn default_override_param() -> String {
    "_ol_ab".to_owned()
}

impl AbExperiment {
    pub fn is_expired(&self, now: DateTime<Utc>) -> bool {
        let Some(raw) = self.expires_at.as_deref() else {
            return false;
        };
        match DateTime::parse_from_rfc3339(raw) {
            Ok(dt) => now >= dt.with_timezone(&Utc),
            // Unparseable expiry fails closed for the experiment (treat expired → serve Control A).
            Err(_) => true,
        }
    }
}

/// Normalize a URL path for matching (`/` stays `/`, `/pricing/` → `/pricing`,
/// `/index.html` → `/`, `/pricing/index.html` → `/pricing`).
pub fn normalize_match_path(raw: &str) -> String {
    let trimmed = raw.trim();
    let with_slash = if trimmed.starts_with('/') {
        trimmed.to_owned()
    } else {
        format!("/{trimmed}")
    };
    let collapsed = if with_slash == "/index.html" {
        "/".to_owned()
    } else if let Some(prefix) = with_slash.strip_suffix("/index.html") {
        if prefix.is_empty() {
            "/".to_owned()
        } else {
            prefix.to_owned()
        }
    } else {
        with_slash
    };
    if collapsed.len() > 1 {
        collapsed.trim_end_matches('/').to_owned()
    } else {
        collapsed
    }
}

fn is_safe_prefix(prefix: &str) -> bool {
    if prefix.is_empty() || prefix.starts_with('/') || prefix.ends_with('/') {
        return false;
    }
    if prefix.contains('\\') || prefix.contains('\0') {
        return false;
    }
    let segments: Vec<&str> = prefix.split('/').collect();
    // `openlen/ab/<id>/…`: at least the reserved root, `ab` and one more segment.
    if segments.len() < 3 || segments[0] != "openlen" || segments[1] != "ab" {
        return false;
    }
    segments
        .iter()
        .all(|seg| !seg.is_empty() && *seg != "." && *seg != "..")
}

/// Parse and strictly validate an `ab.json` payload. Returns `None` if schema
/// version is unknown, JSON is malformed, or no valid experiments survive.
pub fn parse_manifest(bytes: &[u8]) -> Option<AbManifest> {
    let mut parsed: AbManifest = serde_json::from_slice(bytes).ok()?;
    if parsed.version != 1 {
        return None;
    }
    parsed.experiments.retain_mut(|exp| {
        if !EXP_ID_RE.is_match(&exp.id) {
            return false;
        }
        if !COOKIE_NAME_RE.is_match(&exp.cookie_name) {
            return false;
        }
        if exp.split_bps > 10_000 {
            return false;
        }
        if exp.salt.is_empty() || exp.salt.len() > 128 {
            return false;
        }
        if !is_safe_prefix(&exp.prefix_b) {
            return false;
        }
        if !COOKIE_NAME_RE.is_match(&exp.override_param) {
            exp.override_param = default_override_param();
        }
        exp.target_path = normalize_match_path(&exp.target_path);
        exp.locales
            .retain(|loc| LOCALE_RE.is_match(&loc.to_ascii_lowercase()));
        for loc in &mut exp.locales {
            *loc = loc.to_ascii_lowercase();
        }
        true
    });
    if parsed.experiments.is_empty() {
        return None;
    }
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_manifest() {
        let json = br#"{
          "version": 1,
          "releaseSha": "a1b2c3d4e5f6",
          "experiments": [{
            "id": "ab_9f3c2a1b",
            "cookieName": "ol_ab_9f3c2a1b",
            "targetPath": "/",
            "includeLocales": true,
            "locales": ["es", "FR"],
            "splitBps": 5000,
            "salt": "3f9a1c8e7b2d4012",
            "prefixB": "openlen/ab/ab_9f3c2a1b/b",
            "overrideParam": "_ol_ab",
            "expiresAt": null
          }]
        }"#;
        let m = parse_manifest(json).expect("valid manifest");
        assert_eq!(m.experiments.len(), 1);
        assert_eq!(m.experiments[0].locales, vec!["es", "fr"]);
        assert_eq!(m.experiments[0].target_path, "/");
    }

    #[test]
    fn rejects_traversal_prefix_and_bad_split() {
        let bad_prefix = br#"{
          "version": 1,
          "experiments": [{
            "id": "ab_12345678",
            "cookieName": "ol_ab_12345678",
            "targetPath": "/",
            "splitBps": 5000,
            "salt": "abcd",
            "prefixB": "openlen/ab/../etc"
          }]
        }"#;
        assert!(parse_manifest(bad_prefix).is_none());

        let bad_split = br#"{
          "version": 1,
          "experiments": [{
            "id": "ab_12345678",
            "cookieName": "ol_ab_12345678",
            "targetPath": "/",
            "splitBps": 10001,
            "salt": "abcd",
            "prefixB": "openlen/ab/ab_12345678/b"
          }]
        }"#;
        assert!(parse_manifest(bad_split).is_none());
    }

    #[test]
    fn variant_b_prefix_must_live_under_the_reserved_openlen_root() {
        let with_prefix = |prefix: &str| {
            format!(
                r#"{{"version":1,"experiments":[{{"id":"ab_12345678","cookieName":"ol_ab_12345678","targetPath":"/","splitBps":5000,"salt":"abcd","prefixB":"{prefix}"}}]}}"#
            )
        };
        assert!(parse_manifest(with_prefix("openlen/ab/ab_12345678/b").as_bytes()).is_some());
        // The pre-move layout and anything else outside `openlen/ab/` is refused.
        assert!(parse_manifest(with_prefix("_ab/ab_12345678/b").as_bytes()).is_none());
        assert!(parse_manifest(with_prefix("openlen/figure/b").as_bytes()).is_none());
        assert!(parse_manifest(with_prefix("openlen/ab").as_bytes()).is_none());
        assert!(parse_manifest(with_prefix("img/ab/b").as_bytes()).is_none());
    }

    #[test]
    fn rejects_unknown_version_and_corrupt_json() {
        assert!(parse_manifest(br#"{"version":2,"experiments":[]}"#).is_none());
        assert!(parse_manifest(b"not-json").is_none());
    }

    #[test]
    fn normalizes_paths() {
        assert_eq!(normalize_match_path("/"), "/");
        assert_eq!(normalize_match_path("/index.html"), "/");
        assert_eq!(normalize_match_path("/pricing/"), "/pricing");
        assert_eq!(normalize_match_path("/pricing/index.html"), "/pricing");
    }
}
