use once_cell::sync::Lazy;
use regex::Regex;

static SUBDOMAIN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?P<sub>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.openlen\.com$")
        .expect("subdomain regex compiles")
});

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
}
