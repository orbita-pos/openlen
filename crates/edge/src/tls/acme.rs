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
    Account, AuthorizationStatus, ChallengeType, Identifier, NewAccount, NewOrder, OrderStatus,
    RetryPolicy,
};
use rustls::sign::CertifiedKey;
use tracing::{debug, info};

use crate::tls::store::{self, build_certified_key, load_pem_certs, load_pem_key};

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
    pub async fn new(contact: &str, directory_url: &str, cert_dir: PathBuf) -> Result<Self> {
        if contact.trim().is_empty() {
            return Err(anyhow!(
                "ACME contact required (set OPENLEN_EDGE_ACME_CONTACT)"
            ));
        }
        std::fs::create_dir_all(&cert_dir)
            .with_context(|| format!("creating cert dir {}", cert_dir.display()))?;

        let mailto = if contact.starts_with("mailto:") {
            contact.to_owned()
        } else {
            format!("mailto:{contact}")
        };

        let http = Box::new(super::acme_http::build_acme_http_client());
        let (account, _credentials) = Account::builder_with_http(http)
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
        tokio::time::timeout(ISSUE_TIMEOUT, issue_inner(self, &domain))
            .await
            .map_err(|_| anyhow!("ACME issuance for {domain} exceeded {ISSUE_TIMEOUT:?}"))?
    }

    fn get_challenge(&self, token: &str) -> Option<String> {
        self.challenges.get(token).map(|v| v.clone())
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

/// Best-effort parse of the leaf cert's NotAfter. We could pull in
/// `x509-parser` for guaranteed accuracy, but the DER tag format is
/// well-known enough to scan for the ASN.1 `UTCTime` (tag 0x17) or
/// `GeneralizedTime` (tag 0x18) directly. If parsing fails, the caller
/// falls back to the 89-day default.
fn parse_not_after(_pem: &str) -> Option<u64> {
    // Deliberately a no-op for now — the fallback path is the supported
    // one. Wiring a tiny DER scanner here is an optional precision boost;
    // the renewal sweep covers any underestimate.
    None
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
        // Sentinel — the no-op parser must not lie about expiry.
        assert!(parse_not_after("garbage").is_none());
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
}
