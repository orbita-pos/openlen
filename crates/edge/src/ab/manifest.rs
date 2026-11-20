//! Strict parser + validator for `<release>/openlen/ab.json`.
//!
//! Malformed manifests or unknown schema versions fail open (`None`) so a bad
//! manifest can never break live traffic — the edge serves Control A cleanly.
//! One malformed experiment is skipped and the others are kept; `lib/ab/serve.ts`
//! (`parseAbManifest`) applies the same rules, and `tests/fixtures/ab/evaluate.json`
//! is run against both.

use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

static EXP_ID_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-z0-9][a-z0-9_-]{3,39}$").expect("valid exp id regex"));
static COOKIE_NAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[A-Za-z0-9_-]{4,64}$").expect("valid cookie regex"));
static LOCALE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-z]{2}(?:-[a-z0-9]{2,4})?$").expect("valid locale regex"));
/// A full RFC 3339 timestamp, upper-case `T` and `Z` only. Anything else (a bare date, a space for
/// the `T`, no zone) is NOT a timestamp, here and in `lib/ab/serve.ts`.
static RFC3339_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$",
    )
    .expect("valid rfc3339 regex")
});

/// Most entries read from an experiment's `overrides`, and the longest one.
const MAX_OVERRIDES: usize = 4096;
const MAX_OVERRIDE_LEN: usize = 1024;

#[derive(Debug, Clone)]
pub struct AbManifest {
    pub version: u32,
    pub release_sha: String,
    pub experiments: Vec<AbExperiment>,
}

#[derive(Debug, Clone)]
pub struct AbExperiment {
    pub id: String,
    pub cookie_name: String,
    pub target_path: String,
    pub include_locales: bool,
    pub locales: Vec<String>,
    /// Basis points (0..=10_000) assigned to Variant B. 5000 = 50/50.
    pub split_bps: u16,
    pub salt: String,
    /// Relative prefix inside `<release>/`, e.g. `openlen/ab/ab_9f3c2a1b/b`. It must live
    /// under the reserved `openlen/ab/` root, so no file of the owner can collide with it.
    pub prefix_b: String,
    pub override_param: String,
    /// A full RFC 3339 timestamp (validated at parse time), or none.
    pub expires_at: Option<String>,
    /// The files (non-pages) whose bytes differ between Variant B and this experiment's control, as
    /// absolute URL paths, normalized and sorted. The publisher writes them INSIDE the experiment;
    /// a file is decided by the experiment that lists it (its cookie, its split, its `prefix_b`)
    /// and marked `no-store` for everybody, so Cloudflare never caches one variant's bytes under
    /// the shared URL. An experiment without the field decides no file.
    pub overrides: Vec<String>,
}

impl AbExperiment {
    /// True if `path` (resolved, case-sensitive) is one of the files this experiment overrides.
    pub fn overrides_file(&self, path: &str) -> bool {
        self.overrides
            .binary_search_by(|p| p.as_str().cmp(path))
            .is_ok()
    }
}

fn default_override_param() -> String {
    "_ol_ab".to_owned()
}

impl AbExperiment {
    pub fn is_expired(&self, now: DateTime<Utc>) -> bool {
        let Some(raw) = self.expires_at.as_deref() else {
            return false;
        };
        match parse_rfc3339_ms(raw) {
            Some(ms) => now.timestamp_millis() >= ms,
            // Not reachable through `parse_manifest` (it drops such an experiment); one built by
            // hand fails closed: expired, so control.
            None => true,
        }
    }
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
    }
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Unix milliseconds of a full RFC 3339 timestamp, or `None` when it is not one (strict: see
/// `RFC3339_RE`; years 1970..=9999, a real calendar day, hour 0..=23, minute and second 0..=59,
/// offset up to 23:59). Fractional seconds are cut to milliseconds. Mirrors `parseRfc3339Ms` in
/// `lib/ab/serve.ts`.
pub fn parse_rfc3339_ms(raw: &str) -> Option<i64> {
    let c = RFC3339_RE.captures(raw)?;
    let num = |i: usize| c.get(i).and_then(|m| m.as_str().parse::<i64>().ok());
    let (y, mo, d, h, mi, s) = (num(1)?, num(2)?, num(3)?, num(4)?, num(5)?, num(6)?);
    if !(1970..=9999).contains(&y) || !(1..=12).contains(&mo) {
        return None;
    }
    if d < 1 || d > days_in_month(y, mo) || h > 23 || mi > 59 || s > 59 {
        return None;
    }
    let mut ms = 0i64;
    if let Some(frac) = c.get(7) {
        let digits: String = frac.as_str().chars().take(3).collect();
        ms = format!("{digits:0<3}").parse::<i64>().ok()?;
    }
    let mut offset_min = 0i64;
    if let (Some(sign), Some(oh), Some(om)) = (c.get(8), num(9), num(10)) {
        if oh > 23 || om > 59 {
            return None;
        }
        offset_min = (oh * 60 + om) * if sign.as_str() == "-" { -1 } else { 1 };
    }
    let secs = days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + s - offset_min * 60;
    Some(secs * 1000 + ms)
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

/// Normalize one entry of an experiment's `overrides` to an absolute URL path (`css/site.css` and
/// `/css/site.css` are the same file). Dot segments, backslashes, NULs and absurd lengths are not
/// files: `None`. Case is kept (the filesystem is case-sensitive). Mirrors `normalizeOverride`.
pub fn normalize_override(raw: &str) -> Option<String> {
    if raw.len() > MAX_OVERRIDE_LEN || raw.contains('\\') || raw.contains('\0') {
        return None;
    }
    let segments: Vec<&str> = raw.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() || segments.iter().any(|s| *s == "." || *s == "..") {
        return None;
    }
    Some(format!("/{}", segments.join("/")))
}

fn parse_experiment(v: &Value) -> Option<AbExperiment> {
    let e = v.as_object()?;
    let id = e.get("id")?.as_str()?;
    if !EXP_ID_RE.is_match(id) {
        return None;
    }
    let cookie_name = e.get("cookieName")?.as_str()?;
    if !COOKIE_NAME_RE.is_match(cookie_name) {
        return None;
    }
    let target_path = e.get("targetPath")?.as_str()?;
    let split = e.get("splitBps")?.as_f64()?;
    if !split.is_finite() || split.fract() != 0.0 || !(0.0..=10_000.0).contains(&split) {
        return None;
    }
    let salt = e.get("salt")?.as_str()?;
    if salt.is_empty() || salt.len() > 128 {
        return None;
    }
    let prefix_b = e.get("prefixB")?.as_str()?;
    if !is_safe_prefix(prefix_b) {
        return None;
    }
    let override_param = match e.get("overrideParam").and_then(Value::as_str) {
        Some(p) if COOKIE_NAME_RE.is_match(p) => p.to_owned(),
        _ => default_override_param(),
    };
    let locales = match e.get("locales").and_then(Value::as_array) {
        Some(list) => list
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_ascii_lowercase)
            .filter(|l| LOCALE_RE.is_match(l))
            .collect(),
        None => Vec::new(),
    };
    let mut overrides: Vec<String> = match e.get("overrides").and_then(Value::as_array) {
        Some(list) => list
            .iter()
            .take(MAX_OVERRIDES)
            .filter_map(Value::as_str)
            .filter_map(normalize_override)
            .collect(),
        None => Vec::new(),
    };
    overrides.sort();
    overrides.dedup();
    let expires_at = match e.get("expiresAt") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if parse_rfc3339_ms(s).is_some() => Some(s.clone()),
        // A date that is not a full timestamp (or not even a string): this experiment is ignored.
        Some(_) => return None,
    };
    Some(AbExperiment {
        id: id.to_owned(),
        cookie_name: cookie_name.to_owned(),
        target_path: normalize_match_path(target_path),
        include_locales: e.get("includeLocales") == Some(&Value::Bool(true)),
        locales,
        split_bps: split as u16,
        salt: salt.to_owned(),
        prefix_b: prefix_b.to_owned(),
        override_param,
        expires_at,
        overrides,
    })
}

/// Parse and strictly validate an `ab.json` payload. Returns `None` if the schema version is
/// unknown, the JSON is malformed, or no valid experiment survives. One malformed experiment is
/// skipped and the others kept; the same rules run in `parseAbManifest` (`lib/ab/serve.ts`).
pub fn parse_manifest(bytes: &[u8]) -> Option<AbManifest> {
    let doc: Value = serde_json::from_slice(bytes).ok()?;
    let obj = doc.as_object()?;
    if obj.get("version")?.as_f64()? != 1.0 {
        return None;
    }
    let experiments: Vec<AbExperiment> = obj
        .get("experiments")?
        .as_array()?
        .iter()
        .filter_map(parse_experiment)
        .collect();
    if experiments.is_empty() {
        return None;
    }
    Some(AbManifest {
        version: 1,
        release_sha: obj
            .get("releaseSha")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        experiments,
    })
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
        // An experiment without `overrides` decides no file.
        assert!(m.experiments[0].overrides.is_empty());
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

    #[test]
    fn overrides_are_normalized_sorted_and_bounded() {
        assert_eq!(normalize_override("css/site.css").as_deref(), Some("/css/site.css"));
        assert_eq!(normalize_override("//css//site.css/").as_deref(), Some("/css/site.css"));
        assert_eq!(normalize_override("/a b.css").as_deref(), Some("/a b.css"));
        for bad in ["", "/", "/a/../b", "/a/./b", r"/a\b", "/a\0b", &"x".repeat(1025)] {
            assert_eq!(normalize_override(bad), None, "{bad:?}");
        }
        let m = parse_manifest(
            br#"{"version":1,"overrides":["/top-level.css"],"experiments":[{"id":"ab_12345678","cookieName":"ol_ab_12345678","targetPath":"/","splitBps":5000,"salt":"abcd","prefixB":"openlen/ab/ab_12345678/b","overrides":["/z.css","a.css","/a.css",7,"/../x"]},{"id":"ab_22222222","cookieName":"ol_ab_22222222","targetPath":"/p","splitBps":5000,"salt":"abcd","prefixB":"openlen/ab/ab_22222222/b","overrides":["/other.css"]}]}"#,
        )
        .expect("manifest");
        // Normalized, sorted, deduped, per experiment — and a top-level list is not read.
        assert_eq!(m.experiments[0].overrides, vec!["/a.css", "/z.css"]);
        assert!(m.experiments[0].overrides_file("/a.css") && !m.experiments[0].overrides_file("/A.css"));
        assert!(!m.experiments[0].overrides_file("/top-level.css"));
        // Each experiment decides only its own files.
        assert!(m.experiments[1].overrides_file("/other.css") && !m.experiments[1].overrides_file("/a.css"));
    }

    #[test]
    fn rfc3339_is_strict_and_exact() {
        let ms = |s: &str| parse_rfc3339_ms(s);
        assert_eq!(ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(ms("2026-06-01T00:00:00Z"), Some(1_780_272_000_000));
        assert_eq!(ms("2026-06-01T00:00:00.5Z"), Some(1_780_272_000_500));
        assert_eq!(ms("2026-06-01T00:00:00.123456Z"), Some(1_780_272_000_123));
        assert_eq!(ms("2026-06-01T02:00:00+02:00"), Some(1_780_272_000_000));
        assert_eq!(ms("2026-05-31T20:00:00-04:00"), Some(1_780_272_000_000));
        assert!(ms("2028-02-29T00:00:00Z").is_some());
        for bad in [
            "2027-01-01",
            "2027-01-01t00:00:00z",
            "2027-01-01 00:00:00Z",
            "2027-01-01T00:00:00",
            "2027-02-29T00:00:00Z",
            "2027-02-30T00:00:00Z",
            "2027-13-01T00:00:00Z",
            "2027-01-01T24:00:00Z",
            "2027-01-01T00:60:00Z",
            "2027-01-01T00:00:60Z",
            "1969-12-31T23:59:59Z",
            "2027-01-01T00:00:00+24:00",
            "2027-01-01T00:00:00+00:60",
            "",
        ] {
            assert_eq!(ms(bad), None, "{bad:?}");
        }
    }
}
