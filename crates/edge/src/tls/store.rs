//! On-disk persistence for ACME-issued certificates.
//!
//! Each domain gets its own directory under `cert_dir`. The directory name is
//! the lower-case hex of the SHA-256 hash of the domain (first 32 chars), so
//! filesystems don't have to swallow dots or unicode hostnames. Files inside:
//!
//! - `cert.pem` — the full chain (leaf + intermediates) as emitted by
//!   Let's Encrypt.
//! - `key.pem`  — the PEM-encoded private key (PKCS#8) generated locally
//!   alongside the CSR.
//! - `meta.txt` — `domain=<host>\nexpires_at=<unix_secs>\n`. We persist
//!   the expiry as a sidecar so the renewal sweep can decide what to refresh
//!   without parsing X.509.
//!
//! Reads are tolerant: a directory missing any of those three files is
//! skipped (logged) rather than failing startup, so a partially-written
//! issuance can't bork the whole server on the next boot.

use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::sign::CertifiedKey;
use sha2::{Digest, Sha256};
use tracing::{debug, warn};

/// Compute the cert-storage directory for `domain` under `cert_dir`. Hashing
/// is deterministic, so the same host always lands in the same path — needed
/// for the "did we already issue this?" check and for renewal.
pub fn cert_dir_for(cert_dir: &Path, domain: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(domain.to_ascii_lowercase().as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    cert_dir.join(&hex[..32])
}

#[derive(Debug)]
pub struct StoredCert {
    pub domain: String,
    pub expires_at: u64,
    pub certified: Arc<CertifiedKey>,
}

/// Write the cert + key + metadata sidecar atomically(ish). The "atomic"
/// guarantee is per-file (via tempfile + rename), not cross-file: a crash
/// between writing cert.pem and key.pem leaves a partial directory, which
/// the loader detects and skips on the next start. Acceptable — the
/// renewal sweep or the next handshake will trigger re-issuance.
pub fn save_cert(
    cert_dir: &Path,
    domain: &str,
    cert_pem: &str,
    key_pem: &str,
    expires_at: u64,
) -> Result<PathBuf> {
    let dir = cert_dir_for(cert_dir, domain);
    fs::create_dir_all(&dir).with_context(|| format!("creating cert dir {}", dir.display()))?;
    write_atomic(&dir.join("cert.pem"), cert_pem.as_bytes())?;
    write_atomic(&dir.join("key.pem"), key_pem.as_bytes())?;
    write_atomic(
        &dir.join("meta.txt"),
        format!("domain={domain}\nexpires_at={expires_at}\n").as_bytes(),
    )?;
    Ok(dir)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("write target has no parent: {}", path.display()))?;
    let tmp = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("cert-tmp")
    ));
    fs::write(&tmp, bytes).with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, path)
        .with_context(|| format!("atomic rename {} -> {}", tmp.display(), path.display()))?;
    Ok(())
}

/// Re-hydrate every cert under `cert_dir`. Malformed or partial directories
/// are skipped with a warning. The caller (resolver init) populates the in-
/// memory custom-cert map with the result.
pub fn load_all(cert_dir: &Path) -> Result<Vec<StoredCert>> {
    let mut out = Vec::new();
    if !cert_dir.exists() {
        debug!(dir = %cert_dir.display(), "cert dir does not exist yet — nothing to load");
        return Ok(out);
    }
    let read = fs::read_dir(cert_dir)
        .with_context(|| format!("reading cert dir {}", cert_dir.display()))?;
    for entry in read {
        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                warn!(error = %err, "skipping unreadable cert dir entry");
                continue;
            }
        };
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir = entry.path();
        match load_one(&dir) {
            Ok(cert) => out.push(cert),
            Err(err) => warn!(
                dir = %dir.display(),
                error = %err,
                "skipping malformed cert dir"
            ),
        }
    }
    Ok(out)
}

pub fn load_one(dir: &Path) -> Result<StoredCert> {
    let meta = read_meta(&dir.join("meta.txt"))?;
    let certified = load_certified_key_from_dir(dir)?;
    Ok(StoredCert {
        domain: meta.domain,
        expires_at: meta.expires_at,
        certified: Arc::new(certified),
    })
}

struct CertMeta {
    domain: String,
    expires_at: u64,
}

fn read_meta(path: &Path) -> Result<CertMeta> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("reading meta.txt at {}", path.display()))?;
    let mut domain = None;
    let mut expires_at = None;
    for line in raw.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("domain=") {
            domain = Some(v.trim().to_ascii_lowercase());
        } else if let Some(v) = line.strip_prefix("expires_at=") {
            expires_at = v.trim().parse::<u64>().ok();
        }
    }
    Ok(CertMeta {
        domain: domain.ok_or_else(|| anyhow!("meta.txt missing `domain=`"))?,
        expires_at: expires_at.ok_or_else(|| anyhow!("meta.txt missing `expires_at=`"))?,
    })
}

/// Build a [`CertifiedKey`] from the `cert.pem` + `key.pem` pair inside `dir`.
/// Public so callers can build a CertifiedKey from arbitrary directories.
pub fn load_certified_key_from_dir(dir: &Path) -> Result<CertifiedKey> {
    let certs = load_pem_certs(&dir.join("cert.pem"))?;
    let key = load_pem_key(&dir.join("key.pem"))?;
    build_certified_key(certs, key)
}

pub fn load_pem_certs(path: &Path) -> Result<Vec<CertificateDer<'static>>> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("opening cert PEM at {}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut out = Vec::new();
    for entry in rustls_pemfile::certs(&mut reader) {
        let cert = entry.with_context(|| format!("reading cert PEM at {}", path.display()))?;
        out.push(cert);
    }
    if out.is_empty() {
        return Err(anyhow!("no certificates found in {}", path.display()));
    }
    Ok(out)
}

pub fn load_pem_key(path: &Path) -> Result<PrivateKeyDer<'static>> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("opening key PEM at {}", path.display()))?;
    let mut reader = BufReader::new(file);
    let key = rustls_pemfile::private_key(&mut reader)
        .with_context(|| format!("reading private key at {}", path.display()))?;
    key.ok_or_else(|| anyhow!("no private key found in {}", path.display()))
}

pub fn build_certified_key(
    certs: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
) -> Result<CertifiedKey> {
    crate::ensure_crypto_provider();
    let provider = rustls::crypto::aws_lc_rs::default_provider();
    let signing_key = provider
        .key_provider
        .load_private_key(key)
        .map_err(|err| anyhow!("loading signing key failed: {err}"))?;
    Ok(CertifiedKey::new(certs, signing_key))
}

/// Seconds until `expires_at`, saturating at zero if already past.
pub fn seconds_until(expires_at: u64) -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    expires_at.saturating_sub(now)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn cert_dir_for_is_deterministic_and_case_insensitive() {
        let base = Path::new("/tmp/certs");
        let a = cert_dir_for(base, "Example.COM");
        let b = cert_dir_for(base, "example.com");
        assert_eq!(a, b, "case must not change the path");
        // Different domains should hash to different paths.
        assert_ne!(cert_dir_for(base, "a.com"), cert_dir_for(base, "b.com"));
    }

    #[test]
    fn save_and_load_round_trip() {
        let tmp = TempDir::new().unwrap();
        let (cert_pem, key_pem) = test_self_signed("example.com");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        save_cert(tmp.path(), "example.com", &cert_pem, &key_pem, now + 86_400).unwrap();
        let loaded = load_all(tmp.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].domain, "example.com");
        assert!(loaded[0].expires_at >= now);
    }

    #[test]
    fn load_skips_directory_missing_meta_txt() {
        let tmp = TempDir::new().unwrap();
        let dir = cert_dir_for(tmp.path(), "broken.com");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("cert.pem"), "garbage").unwrap();
        // No meta.txt and no valid PEM — must skip cleanly.
        let loaded = load_all(tmp.path()).unwrap();
        assert!(loaded.is_empty());
    }

    #[test]
    fn load_skips_directory_with_malformed_pem() {
        let tmp = TempDir::new().unwrap();
        let dir = cert_dir_for(tmp.path(), "bad.com");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("cert.pem"),
            "-----BEGIN CERTIFICATE-----\nnot base64\n-----END CERTIFICATE-----",
        )
        .unwrap();
        fs::write(
            dir.join("key.pem"),
            "-----BEGIN PRIVATE KEY-----\nalso garbage\n-----END PRIVATE KEY-----",
        )
        .unwrap();
        fs::write(dir.join("meta.txt"), "domain=bad.com\nexpires_at=999999\n").unwrap();
        let loaded = load_all(tmp.path()).unwrap();
        assert!(loaded.is_empty(), "malformed PEM must be skipped");
    }

    #[test]
    fn save_atomic_overwrites_existing_files() {
        let tmp = TempDir::new().unwrap();
        let (cert_pem, key_pem) = test_self_signed("rotate.com");
        save_cert(tmp.path(), "rotate.com", &cert_pem, &key_pem, 1000).unwrap();
        let (cert_pem2, key_pem2) = test_self_signed("rotate.com");
        save_cert(tmp.path(), "rotate.com", &cert_pem2, &key_pem2, 9999).unwrap();
        let loaded = load_all(tmp.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(
            loaded[0].expires_at, 9999,
            "expires_at must be the second write"
        );
    }

    #[test]
    fn seconds_until_saturates_at_zero_for_past_timestamps() {
        assert_eq!(seconds_until(0), 0);
    }

    #[test]
    fn load_returns_empty_when_dir_does_not_exist() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("does-not-exist");
        assert!(load_all(&path).unwrap().is_empty());
    }

    pub(crate) fn test_self_signed(cn: &str) -> (String, String) {
        let rcgen::CertifiedKey { cert, key_pair } =
            rcgen::generate_simple_self_signed(vec![cn.to_string()]).unwrap();
        (cert.pem(), key_pair.serialize_pem())
    }

    #[test]
    fn build_certified_key_accepts_self_signed() {
        let (cert_pem, key_pem) = test_self_signed("build.com");
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("cert.pem"), &cert_pem).unwrap();
        fs::write(tmp.path().join("key.pem"), &key_pem).unwrap();
        let certified = load_certified_key_from_dir(tmp.path()).unwrap();
        assert!(!certified.cert.is_empty());
    }
}
