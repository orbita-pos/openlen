use once_cell::sync::Lazy;
use regex::Regex;

static SUBDOMAIN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?P<sub>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.openlen\.com$")
        .expect("subdomain regex compiles")
});

/// Public-hostname (RFC 1123) regex. Used to gate custom-domain lookups so a
/// bogus Host header doesn't cause a Postgres roundtrip.
///
/// The TS counterpart in `lib/custom-domains.ts` includes a lookahead for
/// total length (`(?=.{1,253}$)`); the `regex` crate doesn't support
/// lookaheads, so the 253-char cap is enforced separately in
/// [`looks_like_public_hostname`].
static PUBLIC_HOSTNAME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
        .expect("public hostname regex compiles")
});

/// Strip a `:port` suffix and lower-case the result.
pub(crate) fn normalize_host(host: &str) -> String {
    host.split(':').next().unwrap_or(host).to_ascii_lowercase()
}

/// Returns the subdomain label for `host` if it matches `*.openlen.com`.
///
/// Strips any `:port` suffix and lower-cases the host before matching, since
/// HTTP host headers are case-insensitive (RFC 9110 § 4.2). The label itself
/// must be 1–63 chars, alphanumeric + hyphen, and may not start or end with a
/// hyphen — matching the DNS label rules from RFC 1035 § 2.3.1.
///
/// Apex (`openlen.com`), nested (`a.b.openlen.com`), wrong-zone hosts, and
/// labels with leading/trailing hyphens all return `None`.
pub fn extract_subdomain(host: &str) -> Option<String> {
    let host_no_port = host.split(':').next()?;
    let host_lc = host_no_port.to_ascii_lowercase();
    SUBDOMAIN_RE
        .captures(&host_lc)
        .and_then(|c| c.name("sub").map(|m| m.as_str().to_owned()))
}

/// True if `host_no_port_lc` is part of the `openlen.com` zone (apex or any
/// subdomain). Used by `decide_route` to keep nested hosts like
/// `a.b.openlen.com` as 404s instead of treating them as a candidate custom
/// domain.
///
/// Caller is responsible for stripping the port + lowercasing.
pub fn is_openlen_zone(host_no_port_lc: &str) -> bool {
    host_no_port_lc == "openlen.com" || host_no_port_lc.ends_with(".openlen.com")
}

/// True if `host_no_port_lc` looks like a public hostname suitable for a
/// custom-domain lookup. Hard rules (matching the Drizzle validator in
/// `lib/custom-domains.ts`):
///
/// - 1–253 chars total
/// - at least one dot (TLD-bearing)
/// - each label 1–63 chars of `[a-z0-9-]`, no leading/trailing hyphen
/// - TLD label all letters, 2–63 chars
///
/// Caller is responsible for stripping the port + lowercasing.
pub fn looks_like_public_hostname(host_no_port_lc: &str) -> bool {
    if host_no_port_lc.is_empty() || host_no_port_lc.len() > 253 {
        return false;
    }
    PUBLIC_HOSTNAME_RE.is_match(host_no_port_lc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_simple_subdomain() {
        assert_eq!(
            extract_subdomain("demo.openlen.com").as_deref(),
            Some("demo")
        );
    }

    #[test]
    fn matches_with_port() {
        assert_eq!(
            extract_subdomain("demo.openlen.com:443").as_deref(),
            Some("demo")
        );
    }

    #[test]
    fn matches_with_hyphen() {
        assert_eq!(
            extract_subdomain("my-site.openlen.com").as_deref(),
            Some("my-site")
        );
    }

    #[test]
    fn matches_single_char_label() {
        assert_eq!(extract_subdomain("a.openlen.com").as_deref(), Some("a"));
    }

    #[test]
    fn matches_max_length_label_63() {
        let label = "a".repeat(63);
        let host = format!("{label}.openlen.com");
        assert_eq!(extract_subdomain(&host).as_deref(), Some(label.as_str()));
    }

    #[test]
    fn rejects_label_too_long_64() {
        let label = "a".repeat(64);
        let host = format!("{label}.openlen.com");
        assert!(extract_subdomain(&host).is_none());
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(
            extract_subdomain("Demo.OpenLen.COM").as_deref(),
            Some("demo")
        );
    }

    #[test]
    fn rejects_apex() {
        assert!(extract_subdomain("openlen.com").is_none());
    }

    #[test]
    fn rejects_nested_subdomain() {
        assert!(extract_subdomain("a.b.openlen.com").is_none());
    }

    #[test]
    fn rejects_wildcard_char() {
        assert!(extract_subdomain("*.openlen.com").is_none());
    }

    #[test]
    fn rejects_leading_hyphen() {
        assert!(extract_subdomain("-bad.openlen.com").is_none());
    }

    #[test]
    fn rejects_trailing_hyphen() {
        assert!(extract_subdomain("bad-.openlen.com").is_none());
    }

    #[test]
    fn rejects_empty_label() {
        assert!(extract_subdomain(".openlen.com").is_none());
    }

    #[test]
    fn rejects_wrong_zone() {
        assert!(extract_subdomain("demo.example.com").is_none());
        assert!(extract_subdomain("demo.openlen.org").is_none());
        assert!(extract_subdomain("openlen.com.attacker.io").is_none());
    }

    #[test]
    fn rejects_empty_host() {
        assert!(extract_subdomain("").is_none());
    }

    #[test]
    fn rejects_underscore() {
        assert!(extract_subdomain("bad_label.openlen.com").is_none());
    }

    #[test]
    fn normalize_host_strips_port_and_lowercases() {
        assert_eq!(normalize_host("Demo.Openlen.COM:443"), "demo.openlen.com");
        assert_eq!(normalize_host("Mybrand.com"), "mybrand.com");
        assert_eq!(normalize_host("MYBRAND.COM:80"), "mybrand.com");
    }

    #[test]
    fn is_openlen_zone_matches_apex_and_subdomains() {
        assert!(is_openlen_zone("openlen.com"));
        assert!(is_openlen_zone("www.openlen.com"));
        assert!(is_openlen_zone("demo.openlen.com"));
        assert!(is_openlen_zone("a.b.openlen.com"));
    }

    #[test]
    fn is_openlen_zone_rejects_other_zones_and_lookalikes() {
        assert!(!is_openlen_zone("mybrand.com"));
        assert!(!is_openlen_zone("openlen.com.attacker.io"));
        assert!(!is_openlen_zone("openlen.org"));
        assert!(!is_openlen_zone(""));
        // Substring is NOT enough — must be the apex or end with the dotted suffix
        assert!(!is_openlen_zone("foopenlen.com"));
    }

    #[test]
    fn looks_like_public_hostname_accepts_typical_domains() {
        assert!(looks_like_public_hostname("mybrand.com"));
        assert!(looks_like_public_hostname("landing.miempresa.com"));
        assert!(looks_like_public_hostname("a.b.c.com"));
        assert!(looks_like_public_hostname("with-hyphen.example.io"));
        assert!(looks_like_public_hostname("a1b2c3.dev"));
    }

    #[test]
    fn looks_like_public_hostname_rejects_garbage() {
        assert!(!looks_like_public_hostname(""));
        assert!(!looks_like_public_hostname("localhost")); // no dot → no TLD
        assert!(!looks_like_public_hostname("127.0.0.1")); // numeric TLD
        assert!(!looks_like_public_hostname("-bad.com"));
        assert!(!looks_like_public_hostname("bad-.com"));
        assert!(!looks_like_public_hostname("bad_label.com"));
        assert!(!looks_like_public_hostname(".com"));
        assert!(!looks_like_public_hostname("com."));
        assert!(!looks_like_public_hostname("xn"));
    }

    #[test]
    fn looks_like_public_hostname_rejects_overlong_total_length() {
        // 254-char total: 63-char label, dot, 63-char label, dot, 63-char label,
        // dot, 60-char label. Total = 63+1+63+1+63+1+60 = 252. Add one more char
        // to push past 253.
        let big = format!(
            "{}.{}.{}.{}",
            "a".repeat(63),
            "a".repeat(63),
            "a".repeat(63),
            "a".repeat(62)
        );
        assert_eq!(big.len(), 254);
        assert!(!looks_like_public_hostname(&big));
    }
}
