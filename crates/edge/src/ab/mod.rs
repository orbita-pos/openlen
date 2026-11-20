//! Edge A/B testing engine (`crates/edge/src/ab/`).
//!
//! Reads per-release `<publish_root>/<sub>/current/openlen/ab.json` via a release-keyed
//! `moka` cache (0 ms invalidation on atomic symlink rotation, zero Postgres
//! queries on the hot path) and resolves traffic deterministically between
//! Control A and Variant B (`openlen/ab/<expId>/b/...`).

pub mod assign;
pub mod bot;
pub mod cache;
pub mod manifest;

#[cfg(test)]
mod fixtures_test;

use std::net::SocketAddr;
use std::path::Path;
use std::time::Instant;

use axum::http::{header, HeaderMap};
use chrono::Utc;

pub use assign::{
    evaluate_manifest, hash_bucket, hash_variant, is_blocked_internal_path, is_internal_ab_file, AbDecision,
    AssignSource, Variant,
};
pub use bot::is_bot;
pub use cache::{AbManifestCache, DEFAULT_AB_MANIFEST_CACHE_MAX};
pub use manifest::{normalize_match_path, parse_manifest, AbExperiment, AbManifest};

/// Extract the best-effort client IP from forwarded Cloudflare/Caddy headers
/// (`cf-connecting-ip`, `x-real-ip`) with TCP peer fallback.
fn client_ip_from_headers(headers: &HeaderMap, peer: SocketAddr) -> String {
    for name in ["cf-connecting-ip", "x-real-ip"] {
        if let Some(val) = headers.get(name).and_then(|v| v.to_str().ok()) {
            let first = val.split(',').next().unwrap_or(val).trim();
            if !first.is_empty() && first.parse::<std::net::IpAddr>().is_ok() {
                return first.to_owned();
            }
        }
    }
    peer.ip().to_string()
}

/// What the A/B decision reads from a request's headers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestFacts {
    pub user_agent: String,
    pub accept_language: String,
    pub cookie: Option<String>,
    pub client_ip: String,
}

/// The facts of a request. A header that is present but not readable (any byte outside visible ASCII
/// and tab, e.g. a UTF-8 'ñ') is treated the same on the edge and in `lib/ab/serve.ts`: the user
/// agent as empty (so a bot), the accept-language as empty, the cookie as absent.
pub fn facts_from_headers(headers: &HeaderMap, peer: SocketAddr) -> RequestFacts {
    let readable = |name| headers.get(name).and_then(|v| v.to_str().ok());
    RequestFacts {
        user_agent: readable(header::USER_AGENT).unwrap_or("").to_owned(),
        accept_language: readable(header::ACCEPT_LANGUAGE).unwrap_or("").to_owned(),
        cookie: readable(header::COOKIE).map(str::to_owned),
        client_ip: client_ip_from_headers(headers, peer),
    }
}

/// Evaluate A/B routing for a subdomain request against `publish_root`.
/// Returns `(decision, resolved_release_dir)`.
#[allow(clippy::too_many_arguments)]
pub async fn evaluate_request(
    cache: &AbManifestCache,
    publish_root: &Path,
    sub: &str,
    url_path: &str,
    query: Option<&str>,
    headers: &HeaderMap,
    peer: SocketAddr,
    secure_cookie: bool,
) -> (Option<AbDecision>, Option<std::path::PathBuf>) {
    let started = Instant::now();
    let (manifest_opt, release_dir) = cache.get(publish_root, sub).await;
    let Some(manifest) = manifest_opt else {
        return (None, release_dir);
    };

    let facts = facts_from_headers(headers, peer);

    let decision = evaluate_manifest(
        &manifest,
        url_path,
        query,
        facts.cookie.as_deref(),
        &facts.user_agent,
        &facts.accept_language,
        &facts.client_ip,
        secure_cookie,
        Utc::now(),
    );

    if let Some(ref d) = decision {
        metrics::counter!(
            "openlen_edge_ab_assignments_total",
            "variant" => d.variant.as_str(),
            "source" => d.source.as_label(),
        )
        .increment(1);
        metrics::histogram!("openlen_edge_ab_decision_duration_seconds")
            .record(started.elapsed().as_secs_f64());
    }

    (decision, release_dir)
}
