//! Zero-DB manifest cache keyed by the RESOLVED release directory.
//!
//! `<publish_root>/<sub>/current` is an atomic symlink to `releases/<sha-12>`. The link is read ONCE
//! per request and the manifest is then read under the directory it named — never through `current`
//! again — so the cache key, the manifest and the directory the files are served from always belong
//! to the same release, even if a publish swaps the link between two syscalls. A new release is a
//! new key: 0 ms invalidation, no polling, no HTTP purge. Negative lookups (a site without a
//! manifest) are cached under the same key, so the disk `ENOENT` happens once per release.
//!
//! What is NOT cached: a transient read error (EIO, EMFILE, a permission blip). It answers "no
//! experiment" for that one request, and the next one reads the file again; a cached error would
//! have turned an experiment off for as long as the release lives. Memory is bounded by an entry
//! count AND a byte budget.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use moka::future::Cache;
use tracing::warn;

use super::manifest::{parse_manifest, AbManifest};

pub const DEFAULT_AB_MANIFEST_CACHE_MAX: u64 = 10_000;
/// Total weight the cache may hold: about the bytes of the manifests it keeps.
pub const DEFAULT_AB_MANIFEST_CACHE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
/// Where a release keeps its experiment manifest. `openlen/` is a reserved root, so no
/// file of the owner can sit there.
pub const AB_MANIFEST_REL: &str = "openlen/ab.json";

/// What reading one release's manifest came to.
#[derive(Debug, Clone)]
pub enum Loaded {
    /// A valid manifest, and the bytes it was read from (its weight in the cache).
    Manifest(Arc<AbManifest>, u32),
    /// No experiment on this release: no file, or a file that is not a valid manifest. Both are the
    /// same forever for an immutable release, so both are cached.
    None,
    /// The read failed in a way that may pass (not ENOENT). Never cached.
    Transient,
}

#[derive(Clone)]
struct Entry {
    manifest: Option<Arc<AbManifest>>,
    weight: u32,
}

#[derive(Clone, Debug)]
pub struct AbManifestCache {
    cache: Cache<String, Entry>,
}

impl std::fmt::Debug for Entry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Entry")
            .field("active", &self.manifest.is_some())
            .field("weight", &self.weight)
            .finish()
    }
}

/// Weight of an entry for the byte budget. Every entry weighs at least `floor`, so the budget also
/// bounds the COUNT: `budget / floor` entries at most.
fn weight_of(key: &str, entry: &Entry, floor: u32) -> u32 {
    let own = entry.weight.saturating_add(key.len() as u32).saturating_add(64);
    own.max(floor)
}

/// A missing file is a fact about the release; anything else may pass.
pub fn is_absent(err: &io::Error) -> bool {
    matches!(
        err.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
    )
}

/// Read and validate `<release_dir>/openlen/ab.json`.
pub async fn load_manifest(sub: &str, release_dir: &Path) -> Loaded {
    let ab_path = release_dir.join(AB_MANIFEST_REL);
    let meta = match tokio::fs::metadata(&ab_path).await {
        Ok(meta) => meta,
        Err(err) if is_absent(&err) => {
            metrics::counter!("openlen_edge_ab_manifest_cache_total", "result" => "miss_none")
                .increment(1);
            return Loaded::None;
        }
        Err(err) => {
            warn!(sub, error = %err, "failed to stat ab.json; serving control for this request");
            metrics::counter!("openlen_edge_ab_manifest_cache_total", "result" => "error")
                .increment(1);
            return Loaded::Transient;
        }
    };
    if !meta.is_file() || meta.len() > MAX_MANIFEST_BYTES {
        warn!(sub, path = %ab_path.display(), "ab.json oversized or not a file; failing open");
        metrics::counter!("openlen_edge_ab_manifest_cache_total", "result" => "invalid")
            .increment(1);
        return Loaded::None;
    }
    let bytes = match tokio::fs::read(&ab_path).await {
        Ok(bytes) => bytes,
        Err(err) if is_absent(&err) => {
            // It was there a moment ago and is gone: the release is being removed.
            return Loaded::None;
        }
        Err(err) => {
            warn!(sub, error = %err, "failed to read ab.json; serving control for this request");
            metrics::counter!("openlen_edge_ab_manifest_cache_total", "result" => "error")
                .increment(1);
            return Loaded::Transient;
        }
    };
    match parse_manifest(&bytes) {
        Some(manifest) => {
            metrics::counter!("openlen_edge_ab_manifest_cache_total", "result" => "miss_active")
                .increment(1);
            Loaded::Manifest(Arc::new(manifest), bytes.len() as u32)
        }
        None => {
            warn!(sub, path = %ab_path.display(), "invalid ab.json manifest; failing open to Control A");
            metrics::counter!("openlen_edge_ab_manifest_cache_total", "result" => "invalid")
                .increment(1);
            Loaded::None
        }
    }
}

impl AbManifestCache {
    /// At most `max_entries` entries and `DEFAULT_AB_MANIFEST_CACHE_BYTES` of weight.
    pub fn new(max_entries: u64) -> Self {
        Self::with_budget(max_entries, DEFAULT_AB_MANIFEST_CACHE_BYTES)
    }

    /// At most `max_entries` entries and `max_bytes` of weight (each entry weighs its manifest's
    /// bytes plus its key, and never less than `max_bytes / max_entries`).
    pub fn with_budget(max_entries: u64, max_bytes: u64) -> Self {
        let max_entries = max_entries.max(1);
        let max_bytes = max_bytes.max(1);
        let floor = u32::try_from((max_bytes / max_entries).max(1)).unwrap_or(u32::MAX);
        Self {
            cache: Cache::builder()
                .max_capacity(max_bytes)
                .weigher(move |key: &String, entry: &Entry| weight_of(key, entry, floor))
                .build(),
        }
    }

    /// The release directory `<sub>/current` names right now, resolved ONCE, with the key that
    /// identifies it. On Unix `current` is a symlink to `releases/<sha-12>` (one `readlink`). Where
    /// symlinks need privileges (Windows dev) `current` may be a file holding `<sha-12>`, or a plain
    /// directory (keyed by mtimes).
    async fn release_key(publish_root: &Path, sub: &str) -> Option<(String, PathBuf)> {
        let sub_dir = publish_root.join(sub);
        let current = sub_dir.join("current");
        if let Ok(target) = tokio::fs::read_link(&current).await {
            let resolved = if target.is_absolute() {
                target
            } else {
                sub_dir.join(target)
            };
            return Some((format!("{sub}:{}", resolved.to_string_lossy()), resolved));
        }
        let meta = tokio::fs::metadata(&current).await.ok()?;
        if meta.is_file() {
            let raw = tokio::fs::read_to_string(&current).await.ok()?;
            let sha = raw.trim();
            if sha.len() >= 6 && sha.len() <= 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                let release_dir = sub_dir.join("releases").join(sha);
                return Some((format!("{sub}:{}", release_dir.to_string_lossy()), release_dir));
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

    /// Look up the parsed manifest of `sub`'s current release (cached per release). Returns
    /// `(manifest, release_dir)`: the callers serve files out of that very directory.
    pub async fn get(
        &self,
        publish_root: &Path,
        sub: &str,
    ) -> (Option<Arc<AbManifest>>, Option<PathBuf>) {
        self.get_with(publish_root, sub, |dir| async move { load_manifest(sub, &dir).await })
            .await
    }

    /// `get` with the reader injected (the tests' door; also where a different store would go).
    pub async fn get_with<F, Fut>(
        &self,
        publish_root: &Path,
        sub: &str,
        load: F,
    ) -> (Option<Arc<AbManifest>>, Option<PathBuf>)
    where
        F: FnOnce(PathBuf) -> Fut,
        Fut: std::future::Future<Output = Loaded>,
    {
        let Some((key, release_dir)) = Self::release_key(publish_root, sub).await else {
            return (None, None);
        };

        if let Some(cached) = self.cache.get(&key).await {
            let label = if cached.manifest.is_some() {
                "hit_active"
            } else {
                "hit_none"
            };
            metrics::counter!("openlen_edge_ab_manifest_cache_total", "result" => label)
                .increment(1);
            return (cached.manifest, Some(release_dir));
        }

        match load(release_dir.clone()).await {
            Loaded::Manifest(manifest, bytes) => {
                self.cache
                    .insert(
                        key,
                        Entry {
                            manifest: Some(manifest.clone()),
                            weight: bytes,
                        },
                    )
                    .await;
                (Some(manifest), Some(release_dir))
            }
            Loaded::None => {
                self.cache
                    .insert(
                        key,
                        Entry {
                            manifest: None,
                            weight: 0,
                        },
                    )
                    .await;
                (None, Some(release_dir))
            }
            // Not cached: the next request reads the file again.
            Loaded::Transient => (None, Some(release_dir)),
        }
    }

    /// Entries held and their total weight (after pending evictions ran). For tests and metrics.
    pub async fn stats(&self) -> (u64, u64) {
        self.cache.run_pending_tasks().await;
        (self.cache.entry_count(), self.cache.weighted_size())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tempfile::TempDir;

    use super::*;

    fn manifest(bytes: u32) -> Loaded {
        let m = parse_manifest(
            br#"{"version":1,"experiments":[{"id":"ab_12345678","cookieName":"ol_ab_12345678","targetPath":"/","splitBps":5000,"salt":"abcd","prefixB":"openlen/ab/ab_12345678/b"}]}"#,
        )
        .expect("manifest");
        Loaded::Manifest(Arc::new(m), bytes)
    }

    /// A site whose `current` is a file holding the sha (the cross-platform pointer).
    fn site(root: &Path, sub: &str, sha: &str) {
        fs::create_dir_all(root.join(sub).join("releases").join(sha)).unwrap();
        fs::write(root.join(sub).join("current"), sha).unwrap();
    }

    #[test]
    fn only_a_missing_file_is_a_fact_about_the_release() {
        assert!(is_absent(&io::Error::from(io::ErrorKind::NotFound)));
        assert!(is_absent(&io::Error::from(io::ErrorKind::NotADirectory)));
        for kind in [
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::Interrupted,
            io::ErrorKind::TimedOut,
            io::ErrorKind::Other,
            io::ErrorKind::OutOfMemory,
        ] {
            assert!(!is_absent(&io::Error::from(kind)), "{kind:?}");
        }
    }

    #[tokio::test]
    async fn a_transient_read_error_is_not_cached_and_the_next_request_reads_again() {
        let dir = TempDir::new().unwrap();
        site(dir.path(), "demo", "aaaa11112222");
        let cache = AbManifestCache::new(100);
        let reads = AtomicUsize::new(0);

        let (m, rel) = cache
            .get_with(dir.path(), "demo", |_| async {
                reads.fetch_add(1, Ordering::SeqCst);
                Loaded::Transient
            })
            .await;
        assert!(m.is_none() && rel.is_some());
        // The error is not remembered: the file is read again, and this time it is there.
        let (m, _) = cache
            .get_with(dir.path(), "demo", |_| async {
                reads.fetch_add(1, Ordering::SeqCst);
                manifest(200)
            })
            .await;
        assert!(m.is_some(), "the experiment must come back once the file reads");
        // Now it is cached: no third read.
        let (m, _) = cache
            .get_with(dir.path(), "demo", |_| async {
                reads.fetch_add(1, Ordering::SeqCst);
                Loaded::Transient
            })
            .await;
        assert!(m.is_some());
        assert_eq!(reads.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn absence_is_cached_per_release_and_a_new_release_is_a_new_key() {
        let dir = TempDir::new().unwrap();
        site(dir.path(), "demo", "aaaa11112222");
        let cache = AbManifestCache::new(100);
        let reads = AtomicUsize::new(0);
        for _ in 0..3 {
            let (m, _) = cache
                .get_with(dir.path(), "demo", |_| async {
                    reads.fetch_add(1, Ordering::SeqCst);
                    Loaded::None
                })
                .await;
            assert!(m.is_none());
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1, "one ENOENT per release");
        // A publish moves `current`: the next request reads the new release.
        site(dir.path(), "demo", "bbbb33334444");
        let (_, rel) = cache
            .get_with(dir.path(), "demo", |_| async {
                reads.fetch_add(1, Ordering::SeqCst);
                manifest(100)
            })
            .await;
        assert_eq!(reads.load(Ordering::SeqCst), 2);
        assert!(rel.unwrap().ends_with("bbbb33334444"));
    }

    #[tokio::test]
    async fn the_manifest_is_read_under_the_directory_the_key_was_made_from() {
        // The loader is handed the RESOLVED release directory, never `current`: the key, the
        // manifest and the directory files are served from are the same release by construction.
        let dir = TempDir::new().unwrap();
        site(dir.path(), "demo", "aaaa11112222");
        let cache = AbManifestCache::new(100);
        let seen = std::sync::Mutex::new(None::<PathBuf>);
        let (_, rel) = cache
            .get_with(dir.path(), "demo", |d| {
                *seen.lock().unwrap() = Some(d);
                async { Loaded::None }
            })
            .await;
        let seen = seen.lock().unwrap().clone().unwrap();
        assert_eq!(Some(seen.clone()), rel);
        assert!(seen.ends_with(Path::new("releases").join("aaaa11112222")), "{seen:?}");
        assert!(!seen.ends_with("current"));
    }

    #[tokio::test]
    async fn memory_is_bounded_by_entries_and_by_bytes() {
        let dir = TempDir::new().unwrap();
        // 60 sites, each with a 1 KiB manifest; budget 8 KiB and at most 4 entries.
        let cache = AbManifestCache::with_budget(4, 8 * 1024);
        for i in 0..60 {
            let sub = format!("site{i}");
            site(dir.path(), &sub, "aaaa11112222");
            cache
                .get_with(dir.path(), &sub, |_| async { manifest(1024) })
                .await;
        }
        let (entries, weight) = cache.stats().await;
        assert!(entries <= 4, "count bound: {entries}");
        assert!(weight <= 8 * 1024, "byte bound: {weight}");
        // And one big manifest cannot starve the rest: it just takes its weight.
        let big = AbManifestCache::with_budget(1000, 8 * 1024);
        for i in 0..20 {
            let sub = format!("big{i}");
            site(dir.path(), &sub, "aaaa11112222");
            big.get_with(dir.path(), &sub, |_| async { manifest(2048) }).await;
        }
        let (entries, weight) = big.stats().await;
        assert!(weight <= 8 * 1024 && entries < 20, "{entries} entries, {weight} bytes");
    }

    #[tokio::test]
    async fn the_real_loader_tells_absent_invalid_and_valid_apart() {
        let dir = TempDir::new().unwrap();
        let rel = dir.path().join("rel");
        fs::create_dir_all(rel.join("openlen")).unwrap();
        assert!(matches!(load_manifest("demo", &rel).await, Loaded::None), "no file");
        fs::write(rel.join("openlen/ab.json"), "not json").unwrap();
        assert!(matches!(load_manifest("demo", &rel).await, Loaded::None), "invalid");
        fs::write(
            rel.join("openlen/ab.json"),
            r#"{"version":1,"experiments":[{"id":"ab_12345678","cookieName":"ol_ab_12345678","targetPath":"/","splitBps":5000,"salt":"abcd","prefixB":"openlen/ab/ab_12345678/b"}]}"#,
        )
        .unwrap();
        match load_manifest("demo", &rel).await {
            Loaded::Manifest(m, bytes) => assert!(m.experiments.len() == 1 && bytes > 100),
            other => panic!("expected a manifest, got {other:?}"),
        }
        // A directory where the file should be is a fact about the release, not an error to retry.
        fs::remove_file(rel.join("openlen/ab.json")).unwrap();
        fs::create_dir_all(rel.join("openlen/ab.json")).unwrap();
        assert!(matches!(load_manifest("demo", &rel).await, Loaded::None));
    }
}
