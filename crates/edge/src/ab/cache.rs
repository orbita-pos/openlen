//! Zero-DB manifest cache keyed by `(sub, release_id)`.
//!
//! Because `<publish_root>/<sub>/current` is an atomic symlink to
//! `releases/<sha-12>`, reading the link target per request gives instant 0 ms
//! invalidation on release rotation without polling or HTTP cache purges.
//! Negative lookups (`None` for sites without `ab.json`) are cached under the
//! same key so disk `ENOENT` only happens once per release.

use std::path::Path;
use std::sync::Arc;

use moka::future::Cache;
use tracing::warn;

use super::manifest::{parse_manifest, AbManifest};

pub const DEFAULT_AB_MANIFEST_CACHE_MAX: u64 = 10_000;
/// Where a release keeps its experiment manifest. `openlen/` is a reserved root, so no
/// file of the owner can sit there.
pub const AB_MANIFEST_REL: &str = "openlen/ab.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug)]
pub struct AbManifestCache {
    cache: Cache<String, Option<Arc<AbManifest>>>,
}

impl AbManifestCache {
    pub fn new(max_capacity: u64) -> Self {
        Self {
            cache: Cache::builder().max_capacity(max_capacity.max(1)).build(),
        }
    }

    /// Resolve the active release identifier for `<sub>/current`.
    ///
    /// On Unix (production) `current` is a symlink `releases/<sha-12>`, so
    /// `read_link` yields the exact immutable release target in one syscall.
    /// On Windows dev (where `current` may be a plain directory or a file
    /// containing `<sha-12>`), falls back cleanly to file content or mtime.
    async fn release_key(publish_root: &Path, sub: &str) -> Option<(String, std::path::PathBuf)> {
        let current = publish_root.join(sub).join("current");
        if let Ok(target) = tokio::fs::read_link(&current).await {
            let key = format!("{sub}:{}", target.to_string_lossy());
            return Some((key, current));
        }
        let meta = tokio::fs::metadata(&current).await.ok()?;
        if meta.is_file() {
            let raw = tokio::fs::read_to_string(&current).await.ok()?;
            let sha = raw.trim();
            if sha.len() >= 6
                && sha.len() <= 64
                && sha.bytes().all(|b| b.is_ascii_hexdigit())
            {
                let release_dir = publish_root.join(sub).join("releases").join(sha);
                return Some((format!("{sub}:releases/{sha}"), release_dir));
            }
            return None;
        }
        if meta.is_dir() {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            // Also check ab.json mtime if present so in-place directory tests invalidate.
            let ab_mtime = tokio::fs::metadata(current.join(AB_MANIFEST_REL))
                .await
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            return Some((format!("{sub}:dir:{mtime}:{ab_mtime}"), current));
        }
        None
    }

    /// Look up the parsed `ab.json` for `sub` (cached per release).
    /// Returns `(manifest, release_root)` so callers serve files out of the
    /// resolved release directory consistently (even on Windows file-pointer fallback).
    pub async fn get(
        &self,
        publish_root: &Path,
        sub: &str,
    ) -> (Option<Arc<AbManifest>>, Option<std::path::PathBuf>) {
        let Some((key, release_dir)) = Self::release_key(publish_root, sub).await else {
            return (None, None);
        };

        if let Some(cached) = self.cache.get(&key).await {
            let label = if cached.is_some() {
                "hit_active"
            } else {
                "hit_none"
            };
            metrics::counter!("openlen_edge_ab_manifest_cache_total", "result" => label)
                .increment(1);
            return (cached, Some(release_dir));
        }

        let ab_path = release_dir.join(AB_MANIFEST_REL);
        let loaded = match tokio::fs::metadata(&ab_path).await {
            Ok(meta) if meta.is_file() && meta.len() <= MAX_MANIFEST_BYTES => {
                match tokio::fs::read(&ab_path).await {
                    Ok(bytes) => match parse_manifest(&bytes) {
                        Some(manifest) => {
                            metrics::counter!(
                                "openlen_edge_ab_manifest_cache_total",
                                "result" => "miss_active"
                            )
                            .increment(1);
                            Some(Arc::new(manifest))
                        }
                        None => {
                            warn!(sub, path = %ab_path.display(), "invalid ab.json manifest; failing open to Control A");
                            metrics::counter!(
                                "openlen_edge_ab_manifest_cache_total",
                                "result" => "invalid"
                            )
                            .increment(1);
                            None
                        }
                    },
                    Err(err) => {
                        warn!(sub, error = %err, "failed to read ab.json; failing open");
                        metrics::counter!(
                            "openlen_edge_ab_manifest_cache_total",
                            "result" => "invalid"
                        )
                        .increment(1);
                        None
                    }
                }
            }
            Ok(_) => {
                warn!(sub, path = %ab_path.display(), "ab.json oversized or not a file; failing open");
                metrics::counter!(
                    "openlen_edge_ab_manifest_cache_total",
                    "result" => "invalid"
                )
                .increment(1);
                None
            }
            Err(_) => {
                metrics::counter!(
                    "openlen_edge_ab_manifest_cache_total",
                    "result" => "miss_none"
                )
                .increment(1);
                None
            }
        };

        self.cache.insert(key, loaded.clone()).await;
        (loaded, Some(release_dir))
    }
}
