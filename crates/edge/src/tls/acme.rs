//! ACME (RFC 8555) HTTP-01 issuance via `instant-acme`.
//!
//! The flow is the standard one:
//!
//! 1. **Account**. `AcmeClient::new` creates (or loads) an ACME account
//!    against the configured directory URL. The contact mailbox is required
//!    by Let's Encrypt; refusing it up front is friendlier than letting a
//!    misconfigured deployment burn LE rate limits with throw-away orders.
//!
//! 2. **Order**. Per-domain we open a `NewOrder` for a single DNS identifier.
//!    Multi-domain SAN issuance isn't needed today — every custom domain
//!    gets its own cert.
//!
//! 3. **HTTP-01 challenge**. For each authorization, we pick the HTTP-01
//!    challenge, compute the key authorization, and stash `token →
//!    key_authorization` in a shared `DashMap`. The HTTP-01 handler on `:80`
//!    serves those tokens; the resolver, ACME polling loop, and renewal
//!    sweep all read from the same map.
//!
//! 4. **Set ready + poll**. We mark each challenge ready and ask
//!    `instant_acme` to poll for us (it has its own backoff).
//!
//! 5. **Finalize + fetch chain**. With the `rcgen` feature enabled the
//!    crate hands us back the private-key PEM and the cert chain PEM in
//!    one go.
//!
//! 6. **Persist**. We write the chain + key + sidecar metadata to disk
//!    via [`super::store::save_cert`] and return a [`CertifiedKey`] for
//!    the in-memory resolver.
//!
//! Errors are translated into a single `anyhow::Error` at the boundary —
//! the call site (the resolver's `issuance_task`) only ever logs + skips.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use dashmap::DashMap;
use instant_acme::{
    Account, AccountCredentials, AuthorizationStatus, ChallengeType, Identifier, NewAccount,
    NewOrder, OrderStatus, RetryPolicy,
};
use rustls::sign::CertifiedKey;
use tracing::{debug, info, warn};

use crate::tls::store::{self, build_certified_key, load_pem_certs, load_pem_key};

/// File inside `cert_dir` that holds the serialized [`AccountCredentials`].
/// Sidecar to the per-domain cert directories so a single secret-store / mount
/// covers everything ACME-related.
pub(crate) const ACCOUNT_FILE: &str = "account.json";

/// Validity used when we can't derive the cert's NotAfter directly from the
/// X.509 envelope. Let's Encrypt issues 90-day certs, so 89 days is a safe
/// upper bound — the renewal sweep triggers before the cert's actual expiry.
const DEFAULT_VALIDITY_SECS: u64 = 89 * 24 * 60 * 60;

/// How long the issuance flow waits, in total, before giving up. Hard cap
/// across the polling and finalize stages. The point is to detect ACME
/// stalls (a misbehaving directory, a dropped DNS record) so the
/// resolver's `in_flight` slot doesn't sit forever.
const ISSUE_TIMEOUT: Duration = Duration::from_secs(120);

/// Result of a single issue / renewal call.
#[derive(Debug, Clone)]
pub struct IssuedCert {
    pub domain: String,
    pub expires_at: u64,
    pub certified: Arc<CertifiedKey>,
}

/// Pluggable surface so the resolver, the HTTP-01 handler, and the
/// renewal sweep can all be tested without spinning up a real ACME server.
#[async_trait]
pub trait AcmeIssuer: Send + Sync + std::fmt::Debug {
    async fn issue(&self, domain: &str) -> Result<IssuedCert>;
    fn get_challenge(&self, token: &str) -> Option<String>;
}

/// Production ACME client. Holds the ACME account + the shared challenge
/// store + the on-disk cert directory.
pub struct AcmeClient {
    account: Account,
    challenges: Arc<DashMap<String, String>>,
    cert_dir: PathBuf,
}

impl std::fmt::Debug for AcmeClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AcmeClient")
            .field("cert_dir", &self.cert_dir)
            .field("challenges_active", &self.challenges.len())
            .finish()
    }
}

impl AcmeClient {
    /// Open (or create) an ACME account against `directory_url` and return
    /// a ready-to-issue client. `contact` is a bare mailbox; we add the
    /// `mailto:` scheme automatically.
    ///
    /// On first boot the account is created against the directory and the
    /// returned [`AccountCredentials`] are persisted to
    /// `${cert_dir}/account.json`. On subsequent boots the credentials are
    /// loaded from disk and the account is restored via
    /// `AccountBuilder::from_credentials`, so we don't re-register and risk
    /// the LE per-IP new-account rate limit during restart storms.
    pub async fn new(contact: &str, directory_url: &str, cert_dir: PathBuf) -> Result<Self> {
        if contact.trim().is_empty() {
            return Err(anyhow!(
                "ACME contact required (set OPENLEN_EDGE_ACME_CONTACT)"
            ));
        }
        std::fs::create_dir_all(&cert_dir)
            .with_context(|| format!("creating cert dir {}", cert_dir.display()))?;

        let account_path = cert_dir.join(ACCOUNT_FILE);
        if let Some(creds) = read_account_credentials(&account_path)? {
            let http = Box::new(super::acme_http::build_acme_http_client());
            match Account::builder_with_http(http)
                .from_credentials(creds)
                .await
            {
                Ok(account) => {
                    info!(
                        path = %account_path.display(),
                        "ACME account restored from persisted credentials"
                    );
                    return Ok(Self {
                        account,
                        challenges: Arc::new(DashMap::new()),
                        cert_dir,
                    });
                }
                Err(err) => warn!(
                    path = %account_path.display(),
                    error = %err,
                    "failed to restore ACME account from credentials — falling back to fresh registration"
                ),
            }
        }

        let mailto = if contact.starts_with("mailto:") {
            contact.to_owned()
        } else {
            format!("mailto:{contact}")
        };

        let http = Box::new(super::acme_http::build_acme_http_client());
        let (account, credentials) = Account::builder_with_http(http)
            .create(
                &NewAccount {
                    contact: &[&mailto],
                    terms_of_service_agreed: true,
                    only_return_existing: false,
                },
                directory_url.to_owned(),
                None,
            )
            .await
            .context("instant-acme: creating account")?;

        if let Err(err) = write_account_credentials(&account_path, &credentials) {
            warn!(
                path = %account_path.display(),
                error = %err,
                "failed to persist ACME account credentials — next boot will re-register"
            );
        }

        info!(directory = %directory_url, "ACME account opened");

        Ok(Self {
            account,
            challenges: Arc::new(DashMap::new()),
            cert_dir,
        })
    }

    /// Construct an [`AcmeClient`] from an already-built [`Account`]. Used
    /// by tests that point at a local mock ACME server (or by callers that
    /// persisted credentials between restarts).
    pub fn from_account(account: Account, cert_dir: PathBuf) -> Self {
        Self {
            account,
            challenges: Arc::new(DashMap::new()),
            cert_dir,
        }
    }

    /// Shared handle into the challenge store — the HTTP-01 listener needs
    /// to read from the same map this client writes to during issuance.
    pub fn challenges(&self) -> Arc<DashMap<String, String>> {
        self.challenges.clone()
    }
}

#[async_trait]
impl AcmeIssuer for AcmeClient {
    async fn issue(&self, domain: &str) -> Result<IssuedCert> {
        let domain = domain.to_ascii_lowercase();
        let started = std::time::Instant::now();
        let outcome = tokio::time::timeout(ISSUE_TIMEOUT, issue_inner(self, &domain)).await;
        let elapsed = started.elapsed().as_secs_f64();
        metrics::histogram!("openlen_edge_cert_issuance_duration_seconds").record(elapsed);
        match outcome {
            Ok(Ok(cert)) => {
                metrics::counter!(
                    "openlen_edge_cert_issuance_total",
                    "result" => "success",
                )
                .increment(1);
                Ok(cert)
            }
            Ok(Err(err)) => {
                let label = classify_issuance_error(&err);
                metrics::counter!(
                    "openlen_edge_cert_issuance_total",
                    "result" => label,
                )
                .increment(1);
                Err(err)
            }
            Err(_) => {
                metrics::counter!(
                    "openlen_edge_cert_issuance_total",
                    "result" => "timeout",
                )
                .increment(1);
                Err(anyhow!(
                    "ACME issuance for {domain} exceeded {ISSUE_TIMEOUT:?}"
                ))
            }
        }
    }

    fn get_challenge(&self, token: &str) -> Option<String> {
        self.challenges.get(token).map(|v| v.clone())
    }
}

/// Rough best-effort classification — the upstream error type is anyhow
/// so we work off the string. Keeps label cardinality bounded.
fn classify_issuance_error(err: &anyhow::Error) -> &'static str {
    let s = err.to_string().to_ascii_lowercase();
    if s.contains("rate") {
        "rate_limited"
    } else if s.contains("invalid") || s.contains("authoriz") || s.contains("identif") {
        "validation_failed"
    } else {
        "other"
    }
}

async fn issue_inner(client: &AcmeClient, domain: &str) -> Result<IssuedCert> {
    debug!(%domain, "ACME: creating order");
    let mut order = client
        .account
        .new_order(&NewOrder::new(&[Identifier::Dns(domain.to_string())]))
        .await
        .context("instant-acme: new_order")?;

    let mut placed_tokens: Vec<String> = Vec::new();
    let mut authorizations = order.authorizations();
    while let Some(result) = authorizations.next().await {
        let mut authz = result.context("instant-acme: authorization fetch")?;
        match authz.status {
            AuthorizationStatus::Pending => {}
            AuthorizationStatus::Valid => continue,
            other => {
                return Err(anyhow!(
                    "unexpected authorization status for {domain}: {other:?}"
                ))
            }
        }
        let mut challenge = authz
            .challenge(ChallengeType::Http01)
            .ok_or_else(|| anyhow!("ACME directory did not offer HTTP-01 for {domain}"))?;
        let token = challenge.token.clone();
        let key_auth = challenge.key_authorization().as_str().to_string();
        debug!(%domain, token = %token, "ACME: HTTP-01 challenge stored");
        client.challenges.insert(token.clone(), key_auth);
        placed_tokens.push(token);
        challenge
            .set_ready()
            .await
            .context("instant-acme: set_challenge_ready")?;
    }
    // The borrow of `order` that `authorizations` held ends here so we
    // can call `poll_ready` / `finalize` below. The actual `drop` is a
    // no-op but the explicit scope makes the intent obvious.
    let _ = authorizations;

    let status = order
        .poll_ready(&RetryPolicy::default())
        .await
        .context("instant-acme: poll_ready")?;
    debug!(%domain, ?status, "ACME: order poll complete");
    match status {
        OrderStatus::Ready => {}
        OrderStatus::Valid => {
            // Already-finalized — still legitimate, we'll fetch the chain
            // below.
        }
        other => {
            cleanup_challenges(client, &placed_tokens);
            return Err(anyhow!(
                "ACME order ended with status {other:?} (not Ready)"
            ));
        }
    }

    let private_key_pem = order.finalize().await.context("instant-acme: finalize")?;
    let cert_chain_pem = order
        .poll_certificate(&RetryPolicy::default())
        .await
        .context("instant-acme: poll_certificate")?;

    cleanup_challenges(client, &placed_tokens);

    let now = now_secs();
    let expires_at = parse_not_after(&cert_chain_pem).unwrap_or(now + DEFAULT_VALIDITY_SECS);
    let stored = persist_and_load(
        &client.cert_dir,
        domain,
        &cert_chain_pem,
        &private_key_pem,
        expires_at,
    )?;
    Ok(IssuedCert {
        domain: domain.to_string(),
        expires_at,
        certified: stored,
    })
}

fn cleanup_challenges(client: &AcmeClient, tokens: &[String]) {
    for t in tokens {
        client.challenges.remove(t);
    }
}

fn persist_and_load(
    cert_dir: &std::path::Path,
    domain: &str,
    cert_pem: &str,
    key_pem: &str,
    expires_at: u64,
) -> Result<Arc<CertifiedKey>> {
    let dir = store::save_cert(cert_dir, domain, cert_pem, key_pem, expires_at)?;
    let certs = load_pem_certs(&dir.join("cert.pem"))?;
    let key = load_pem_key(&dir.join("key.pem"))?;
    Ok(Arc::new(build_certified_key(certs, key)?))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Try to load persisted [`AccountCredentials`] from `path`. Returns `Ok(None)`
/// if the file is absent (fresh install). Surfaces an error if the file
/// exists but can't be parsed — we'd rather fail loud than silently re-register
/// over an unparseable account file.
pub(crate) fn read_account_credentials(
    path: &std::path::Path,
) -> Result<Option<AccountCredentials>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading ACME account credentials at {}", path.display()))?;
    let creds = serde_json::from_str::<AccountCredentials>(&raw)
        .with_context(|| format!("parsing ACME account credentials at {}", path.display()))?;
    Ok(Some(creds))
}

/// Atomically persist `credentials` to `path` (tempfile + rename). On Unix
/// the file ends up with mode 0o600 — the key material is sensitive and
/// reading it should require the same uid that runs the edge.
pub(crate) fn write_account_credentials(
    path: &std::path::Path,
    credentials: &AccountCredentials,
) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("write target has no parent: {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("creating account dir {}", parent.display()))?;
    let tmp = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("account-tmp")
    ));
    let body = serde_json::to_vec(credentials).context("serializing ACME account credentials")?;
    std::fs::write(&tmp, &body).with_context(|| format!("writing {}", tmp.display()))?;
    set_owner_only_perms(&tmp);
    std::fs::rename(&tmp, path)
        .with_context(|| format!("atomic rename {} -> {}", tmp.display(), path.display()))?;
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_perms(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Err(err) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
        warn!(path = %path.display(), error = %err, "failed to set 0600 on account credentials");
    }
}

#[cfg(not(unix))]
fn set_owner_only_perms(_path: &std::path::Path) {}

/// Parse the leaf cert's NotAfter and return it as unix seconds.
///
/// We deliberately avoid pulling `x509-parser` (or any ASN.1 crate) — that
/// would re-add ~150 KiB to the binary right after A1's swap trimmed
/// `rustls-platform-verifier`. Instead we walk the DER envelope by hand: PEM
/// → DER via `rustls_pemfile` (already in the dep graph for cert loading),
/// then the well-known X.509 SEQUENCE layout down to `validity.notAfter`.
///
/// Returns `None` on any parse failure — the caller falls back to the
/// 89-day default which keeps the renewal sweep firing on time.
fn parse_not_after(pem: &str) -> Option<u64> {
    let mut reader = pem.as_bytes();
    let der = rustls_pemfile::certs(&mut reader).next()?.ok()?;
    parse_not_after_der(&der)
}

fn parse_not_after_der(der: &[u8]) -> Option<u64> {
    // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm,
    //                            signatureValue }
    let cert_body = read_sequence(der)?;
    // TBSCertificate ::= SEQUENCE { version [0] EXPLICIT? Default v1,
    //                               serialNumber INTEGER,
    //                               signature AlgorithmIdentifier,
    //                               issuer Name,
    //                               validity Validity, ... }
    let tbs = read_sequence(cert_body)?;
    let after_version = skip_explicit_version(tbs);
    let after_serial = skip_tlv(after_version)?;
    let after_sig = skip_tlv(after_serial)?;
    let after_issuer = skip_tlv(after_sig)?;
    // Validity ::= SEQUENCE { notBefore Time, notAfter Time }
    let validity = read_sequence(after_issuer)?;
    let after_not_before = skip_tlv(validity)?;
    let (tag, value, _) = read_tlv(after_not_before)?;
    parse_asn1_time(tag, value)
}

/// Read a SEQUENCE (tag 0x30) and return its value bytes.
fn read_sequence(bytes: &[u8]) -> Option<&[u8]> {
    let (tag, value, _) = read_tlv(bytes)?;
    if tag != 0x30 {
        return None;
    }
    Some(value)
}

/// Skip the optional `[0] EXPLICIT version` wrapper (tag 0xA0). When absent
/// the integer is just the version part, which is the default v1.
fn skip_explicit_version(bytes: &[u8]) -> &[u8] {
    if let Some((tag, _, rest)) = read_tlv(bytes) {
        if tag == 0xA0 {
            return rest;
        }
    }
    bytes
}

/// Skip one TLV by returning the slice following it.
fn skip_tlv(bytes: &[u8]) -> Option<&[u8]> {
    let (_, _, rest) = read_tlv(bytes)?;
    Some(rest)
}

/// Parse a single DER TLV. Returns (tag, value, rest). Long-form lengths up
/// to 4 bytes are supported; that covers every leaf cert we'll ever see.
fn read_tlv(bytes: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let tag = *bytes.first()?;
    let after_tag = bytes.get(1..)?;
    let (len, after_len) = read_length(after_tag)?;
    if after_len.len() < len {
        return None;
    }
    let (value, rest) = after_len.split_at(len);
    Some((tag, value, rest))
}

fn read_length(bytes: &[u8]) -> Option<(usize, &[u8])> {
    let first = *bytes.first()?;
    let rest = bytes.get(1..)?;
    if first < 0x80 {
        return Some((first as usize, rest));
    }
    let n = (first & 0x7F) as usize;
    if n == 0 || n > 4 || rest.len() < n {
        return None;
    }
    let mut len = 0usize;
    for &b in &rest[..n] {
        len = (len << 8) | (b as usize);
    }
    Some((len, &rest[n..]))
}

/// Parse an ASN.1 UTCTime (`tag 0x17`, `YYMMDDHHMMSSZ`) or GeneralizedTime
/// (`tag 0x18`, `YYYYMMDDHHMMSSZ`) into a unix timestamp. Only the `Z`
/// (UTC) variant is supported — every CA we care about emits Zulu times.
fn parse_asn1_time(tag: u8, value: &[u8]) -> Option<u64> {
    let s = std::str::from_utf8(value).ok()?;
    let (y, m, d, hh, mm, ss) = match tag {
        0x17 if s.len() == 13 && s.ends_with('Z') => {
            let yy: u32 = s.get(0..2)?.parse().ok()?;
            // RFC 5280 §4.1.2.5.1: 00-49 → 2000-2049, 50-99 → 1950-1999.
            let year = if yy < 50 { 2000 + yy } else { 1900 + yy };
            let m: u32 = s.get(2..4)?.parse().ok()?;
            let d: u32 = s.get(4..6)?.parse().ok()?;
            let hh: u32 = s.get(6..8)?.parse().ok()?;
            let mm: u32 = s.get(8..10)?.parse().ok()?;
            let ss: u32 = s.get(10..12)?.parse().ok()?;
            (year, m, d, hh, mm, ss)
        }
        0x18 if s.len() == 15 && s.ends_with('Z') => {
            let year: u32 = s.get(0..4)?.parse().ok()?;
            let m: u32 = s.get(4..6)?.parse().ok()?;
            let d: u32 = s.get(6..8)?.parse().ok()?;
            let hh: u32 = s.get(8..10)?.parse().ok()?;
            let mm: u32 = s.get(10..12)?.parse().ok()?;
            let ss: u32 = s.get(12..14)?.parse().ok()?;
            (year, m, d, hh, mm, ss)
        }
        _ => return None,
    };
    ymdhms_to_unix(y, m, d, hh, mm, ss)
}

fn ymdhms_to_unix(year: u32, month: u32, day: u32, hh: u32, mm: u32, ss: u32) -> Option<u64> {
    if !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hh >= 24
        || mm >= 60
        || ss >= 60
    {
        return None;
    }
    let mut days: u64 = 0;
    for y in 1970..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }
    for m in 1..month {
        days += days_in_month(year, m) as u64;
    }
    days += (day - 1) as u64;
    Some(days * 86_400 + (hh as u64) * 3_600 + (mm as u64) * 60 + (ss as u64))
}

fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

#[cfg(test)]
impl AcmeClient {
    /// Build a non-functional [`AcmeClient`] for tests that only need the
    /// type to type-check. Calling [`AcmeClient::issue`] on the dummy
    /// panics — wrap in a `MockAcmeIssuer` instead when the test actually
    /// triggers issuance.
    pub fn test_dummy() -> Self {
        Self::test_dummy_with_dir(std::path::PathBuf::from("/tmp/openlen-test-certs"))
    }

    pub fn test_dummy_with_dir(cert_dir: std::path::PathBuf) -> Self {
        // We can't synthesise an `instant_acme::Account` without a directory
        // round-trip, so the dummy isn't actually constructible. Tests must
        // use `MockAcmeIssuer` (below) when issuance matters. Anything else
        // can build the type via this `unreachable!` route only if the
        // resolver doesn't trigger issuance — but those tests pass `None`
        // for `acme` instead. So this dummy is never constructed in
        // practice; we surface a deliberate panic if it ever is.
        let _ = cert_dir;
        panic!(
            "AcmeClient::test_dummy() must not be called — pass an Arc<dyn AcmeIssuer> \
             (e.g. MockAcmeIssuer) to the resolver instead"
        );
    }
}

/// Stand-in [`AcmeIssuer`] for tests. Behaviour is fully controllable:
/// callers can pre-seed the response cert + expiry, decide whether to fail
/// the issuance, and inspect the call count.
#[cfg(test)]
pub use mock::MockAcmeIssuer;

#[cfg(test)]
pub(crate) mod mock {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Mutex;

    #[derive(Debug, Default)]
    pub struct MockAcmeIssuer {
        inner: Arc<MockInner>,
    }

    #[derive(Debug, Default)]
    struct MockInner {
        challenges: Arc<DashMap<String, String>>,
        calls: AtomicUsize,
        fail_mode: Mutex<bool>,
        delay_ms: Mutex<u64>,
        seed_cert: Mutex<Option<IssuedCert>>,
    }

    impl MockAcmeIssuer {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn calls(&self) -> usize {
            self.inner.calls.load(Ordering::SeqCst)
        }

        pub async fn set_fail(&self, on: bool) {
            *self.inner.fail_mode.lock().await = on;
        }

        pub async fn set_delay_ms(&self, ms: u64) {
            *self.inner.delay_ms.lock().await = ms;
        }

        pub async fn seed_issuance(&self, cert: IssuedCert) {
            *self.inner.seed_cert.lock().await = Some(cert);
        }

        pub fn challenges(&self) -> Arc<DashMap<String, String>> {
            self.inner.challenges.clone()
        }

        /// Manually drop a token into the challenge store so the HTTP-01
        /// handler tests can probe it without driving the full issue flow.
        pub fn store_challenge(&self, token: impl Into<String>, key_auth: impl Into<String>) {
            self.inner.challenges.insert(token.into(), key_auth.into());
        }
    }

    #[async_trait]
    impl AcmeIssuer for MockAcmeIssuer {
        async fn issue(&self, domain: &str) -> Result<IssuedCert> {
            self.inner.calls.fetch_add(1, Ordering::SeqCst);
            let delay = *self.inner.delay_ms.lock().await;
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
            if *self.inner.fail_mode.lock().await {
                return Err(anyhow!("mock acme failure"));
            }
            // Token+key are observable so a parallel test can assert that
            // the handler is hooked up.
            self.inner
                .challenges
                .insert(format!("token-{domain}"), format!("ka-{domain}"));
            if let Some(seed) = self.inner.seed_cert.lock().await.clone() {
                return Ok(seed);
            }
            // Default: synthesise a CertifiedKey from a self-signed cert.
            let (cert_pem, key_pem) = crate::tls::store::tests::test_self_signed(domain);
            let tmp = tempfile::TempDir::new()?;
            std::fs::write(tmp.path().join("cert.pem"), &cert_pem)?;
            std::fs::write(tmp.path().join("key.pem"), &key_pem)?;
            let certified = Arc::new(crate::tls::store::load_certified_key_from_dir(tmp.path())?);
            Ok(IssuedCert {
                domain: domain.to_string(),
                expires_at: now_secs() + DEFAULT_VALIDITY_SECS,
                certified,
            })
        }

        fn get_challenge(&self, token: &str) -> Option<String> {
            self.inner.challenges.get(token).map(|v| v.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_issuer_returns_cert_and_stores_challenge() {
        let mock = mock::MockAcmeIssuer::new();
        let issued = mock.issue("example.com").await.unwrap();
        assert_eq!(issued.domain, "example.com");
        assert!(issued.expires_at > now_secs());
        assert_eq!(mock.calls(), 1);
        // The mock stores a synthetic token after issue().
        assert!(mock.get_challenge("token-example.com").is_some());
    }

    #[tokio::test]
    async fn mock_issuer_propagates_fail_mode() {
        let mock = mock::MockAcmeIssuer::new();
        mock.set_fail(true).await;
        let err = mock.issue("example.com").await.unwrap_err();
        assert!(err.to_string().contains("mock acme failure"));
    }

    #[test]
    fn parse_not_after_returns_none_for_unknown_format() {
        // Non-PEM input must not panic and must surface None — the caller
        // falls back to the 89-day default.
        assert!(parse_not_after("garbage").is_none());
        assert!(parse_not_after("").is_none());
    }

    #[test]
    fn parse_not_after_reads_self_signed_cert_expiry() {
        // What matters for this test is that we extract a finite, future
        // timestamp — not the 89-day fallback the caller uses when the
        // parse fails. `rcgen::generate_simple_self_signed` defaults
        // `not_after` to year 4096, so the parsed value sits far in the
        // future; we just check it's not in the past and not absurd.
        let (cert_pem, _) = crate::tls::store::tests::test_self_signed("expiry.test");
        let after = parse_not_after(&cert_pem).expect("must parse self-signed cert");
        let now = now_secs();
        assert!(after > now, "expiry must be in the future, got {after}");
        // Year 9999 cap — defends against integer overflow / wild parses.
        let year_9999 = ymdhms_to_unix(9999, 12, 31, 23, 59, 59).unwrap();
        assert!(after <= year_9999, "expiry must be in-range, got {after}");
    }

    #[test]
    fn ymdhms_to_unix_handles_known_epoch() {
        // 1970-01-01T00:00:00Z = 0
        assert_eq!(ymdhms_to_unix(1970, 1, 1, 0, 0, 0), Some(0));
        // 2024-01-01T00:00:00Z = 1704067200 (independently verified)
        assert_eq!(ymdhms_to_unix(2024, 1, 1, 0, 0, 0), Some(1_704_067_200));
        // 2024 was a leap year — 2024-03-01 follows Feb 29
        assert_eq!(ymdhms_to_unix(2024, 3, 1, 0, 0, 0), Some(1_709_251_200));
        // 2023 was NOT a leap year — 2023-03-01 follows Feb 28
        assert_eq!(ymdhms_to_unix(2023, 3, 1, 0, 0, 0), Some(1_677_628_800));
    }

    #[test]
    fn ymdhms_to_unix_rejects_garbage() {
        assert!(ymdhms_to_unix(2024, 13, 1, 0, 0, 0).is_none()); // month 13
        assert!(ymdhms_to_unix(2024, 1, 32, 0, 0, 0).is_none()); // day 32
        assert!(ymdhms_to_unix(2024, 1, 1, 24, 0, 0).is_none()); // hour 24
        assert!(ymdhms_to_unix(2024, 1, 1, 0, 60, 0).is_none()); // minute 60
        assert!(ymdhms_to_unix(2024, 1, 1, 0, 0, 60).is_none()); // second 60
        assert!(ymdhms_to_unix(1900, 1, 1, 0, 0, 0).is_none()); // year < 1970
    }

    #[test]
    fn parse_asn1_time_handles_utctime() {
        // 240315120000Z → 2024-03-15T12:00:00Z
        let v = b"240315120000Z";
        let secs = parse_asn1_time(0x17, v).expect("UTCTime");
        // 2024-03-15T12:00:00Z = 1710504000 (independently verified)
        assert_eq!(secs, 1_710_504_000);
    }

    #[test]
    fn parse_asn1_time_handles_generalizedtime() {
        // 20240315120000Z → same wall clock as the UTCTime above
        let v = b"20240315120000Z";
        let secs = parse_asn1_time(0x18, v).expect("GeneralizedTime");
        assert_eq!(secs, 1_710_504_000);
    }

    #[test]
    fn parse_asn1_time_rejects_non_zulu() {
        // Missing trailing Z → unsupported timezone offset, reject.
        assert!(parse_asn1_time(0x17, b"240315120000+").is_none());
        assert!(parse_asn1_time(0x18, b"20240315120000+").is_none());
    }

    #[test]
    fn parse_asn1_time_utctime_two_digit_year_pivot() {
        // 00-49 → 2000-2049
        let v_2024 = b"240101000000Z";
        let v_1999 = b"990101000000Z";
        let s_2024 = parse_asn1_time(0x17, v_2024).expect("2024");
        let s_1999 = parse_asn1_time(0x17, v_1999).expect("1999");
        assert!(s_2024 > s_1999, "2024 > 1999 wall clock");
    }

    #[test]
    fn read_length_short_form() {
        let (len, rest) = read_length(&[0x05, 0xAA, 0xBB]).unwrap();
        assert_eq!(len, 5);
        assert_eq!(rest, &[0xAA, 0xBB]);
    }

    #[test]
    fn read_length_long_form_two_bytes() {
        // 0x82 → next 2 bytes are the length
        let (len, rest) = read_length(&[0x82, 0x01, 0xFF, 0xAA]).unwrap();
        assert_eq!(len, 0x01FF);
        assert_eq!(rest, &[0xAA]);
    }

    #[test]
    fn read_length_rejects_zero_byte_long_form() {
        // 0x80 (indefinite length, illegal in DER) must be refused
        assert!(read_length(&[0x80, 0xAA]).is_none());
    }

    #[test]
    fn now_secs_returns_positive_value() {
        assert!(now_secs() > 1_700_000_000, "wallclock must be sane");
    }

    #[tokio::test]
    async fn mock_issuer_store_challenge_is_observable_via_get() {
        let mock = mock::MockAcmeIssuer::new();
        mock.store_challenge("abc", "key-auth-abc");
        assert_eq!(mock.get_challenge("abc").as_deref(), Some("key-auth-abc"));
        assert_eq!(mock.get_challenge("missing"), None);
    }

    /// Build a minimally-valid serialized AccountCredentials JSON blob. The
    /// PKCS#8 payload is non-decryptable nonsense — instant-acme's
    /// deserializer only checks the base64 framing, not the inner key — so
    /// this is enough to exercise the file-I/O round trip without needing
    /// rcgen or a real CA roundtrip in the test path.
    fn sample_credentials_json() -> String {
        // 24 bytes of zeroes, base64-url-safe-no-pad. Decodes cleanly so
        // PrivatePkcs8KeyDer::from accepts the bytes.
        const FAKE_PKCS8_B64: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        format!(
            r#"{{"id":"https://acme-staging-v02.api.letsencrypt.org/acme/acct/123","key_pkcs8":"{FAKE_PKCS8_B64}","directory":"https://acme-staging-v02.api.letsencrypt.org/directory"}}"#
        )
    }

    #[test]
    fn read_account_credentials_returns_none_when_file_missing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join(ACCOUNT_FILE);
        assert!(!path.exists());
        assert!(read_account_credentials(&path).unwrap().is_none());
    }

    #[test]
    fn write_then_read_account_credentials_round_trip() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join(ACCOUNT_FILE);
        let creds: AccountCredentials = serde_json::from_str(&sample_credentials_json()).unwrap();
        write_account_credentials(&path, &creds).unwrap();
        assert!(path.exists());
        let loaded = read_account_credentials(&path).unwrap().expect("Some");
        let back = serde_json::to_string(&loaded).unwrap();
        assert!(back.contains("acme/acct/123"));
        assert!(back.contains("acme-staging-v02"));
    }

    #[test]
    fn read_account_credentials_surfaces_parse_error_for_garbage() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join(ACCOUNT_FILE);
        std::fs::write(&path, b"not json").unwrap();
        match read_account_credentials(&path) {
            Ok(_) => panic!("expected parse error"),
            Err(err) => {
                let msg = format!("{err:#}");
                assert!(
                    msg.contains("parsing ACME account credentials"),
                    "msg: {msg}"
                );
            }
        }
    }

    #[test]
    fn write_account_credentials_replaces_existing_atomically() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join(ACCOUNT_FILE);
        let creds: AccountCredentials = serde_json::from_str(&sample_credentials_json()).unwrap();
        write_account_credentials(&path, &creds).unwrap();
        let first = std::fs::read_to_string(&path).unwrap();
        // Second write with the same blob should leave the file unchanged
        // (atomic rename, no partial state).
        write_account_credentials(&path, &creds).unwrap();
        let second = std::fs::read_to_string(&path).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn write_account_credentials_creates_parent_dir_if_missing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let nested = tmp.path().join("nested/sub");
        let path = nested.join(ACCOUNT_FILE);
        let creds: AccountCredentials = serde_json::from_str(&sample_credentials_json()).unwrap();
        write_account_credentials(&path, &creds).unwrap();
        assert!(path.exists());
        assert!(nested.exists());
    }

    #[cfg(unix)]
    #[test]
    fn write_account_credentials_sets_owner_only_perms_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join(ACCOUNT_FILE);
        let creds: AccountCredentials = serde_json::from_str(&sample_credentials_json()).unwrap();
        write_account_credentials(&path, &creds).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "expected 0o600, got {mode:o}");
    }
}
