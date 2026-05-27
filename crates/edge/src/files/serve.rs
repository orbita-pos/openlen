use std::path::{Component, Path, PathBuf};

use percent_encoding::percent_decode_str;

/// What `resolve` returned about the request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolved {
    /// File exists on disk under the publish root. Always a regular file
    /// whose canonical path is inside `publish_root`.
    File(PathBuf),
    /// Request is for an asset (path has an extension) and that asset is
    /// missing — caller should respond 404 without falling back to HTML.
    NotFound,
    /// Path is invalid (traversal, NUL byte, malformed UTF-8).
    BadRequest,
}

/// Resolve a URL path against `publish_root` using a try-files chain that
/// mirrors `nginx`'s `try_files $uri $uri/index.html /index.html`.
///
/// Rules:
/// * `GET /` → `<root>/index.html`.
/// * `GET /foo.svg` (path with extension): serve `<root>/foo.svg` or `NotFound`
///   — no SPA fallback for asset misses, because a 200 HTML response for a
///   missing PNG breaks tooling.
/// * `GET /pricing` (path with no extension): try `<root>/pricing` as a file,
///   then `<root>/pricing/index.html`, then `<root>/index.html` (SPA fallback).
///   `BadRequest` if `..`, `\0`, drive prefixes, or other dangerous components
///   appear in the decoded path.
///
/// `publish_root` must already be canonical (`std::fs::canonicalize`d at
/// startup). The returned path is checked to live inside it after the
/// filesystem lookup, so symlinks pointing outside the root cannot escape.
pub fn resolve(publish_root: &Path, url_path: &str) -> Resolved {
    let decoded = match percent_decode_str(url_path).decode_utf8() {
        Ok(s) => s.into_owned(),
        Err(_) => return Resolved::BadRequest,
    };

    if decoded.contains('\0') {
        return Resolved::BadRequest;
    }

    let rel = decoded.trim_start_matches('/');
    // strip trailing slash from non-empty paths so /about/ behaves like /about
    let rel = rel.strip_suffix('/').unwrap_or(rel);

    if !is_safe(rel) {
        return Resolved::BadRequest;
    }

    let has_ext = !rel.is_empty() && Path::new(rel).extension().is_some();

    if rel.is_empty() {
        return resolve_existing(publish_root, &publish_root.join("index.html"));
    }

    let direct = publish_root.join(rel);
    if let resolved @ Resolved::File(_) = resolve_existing(publish_root, &direct) {
        return resolved;
    }

    if has_ext {
        return Resolved::NotFound;
    }

    let dir_index = direct.join("index.html");
    if let resolved @ Resolved::File(_) = resolve_existing(publish_root, &dir_index) {
        return resolved;
    }

    resolve_existing(publish_root, &publish_root.join("index.html"))
}

/// Strict lookup: serve `<root>/<rel_path>` if it exists, else `NotFound`. No
/// SPA fallback, no directory index. Used by the shared roots
/// (`/var/openlen/uploads`, `/opt/openlen-app/.next/static`) where a missing
/// file is a real 404 and falling back to an HTML index would mask broken
/// references.
///
/// The path is percent-decoded + walked for traversal exactly like
/// [`resolve`]; an absolute / NUL-bearing / `..`-bearing input still surfaces
/// as `BadRequest`.
pub fn resolve_strict(root: &Path, rel_path: &str) -> Resolved {
    let decoded = match percent_decode_str(rel_path).decode_utf8() {
        Ok(s) => s.into_owned(),
        Err(_) => return Resolved::BadRequest,
    };
    if decoded.contains('\0') {
        return Resolved::BadRequest;
    }
    let rel = decoded.trim_start_matches('/');
    let rel = rel.strip_suffix('/').unwrap_or(rel);
    if !is_safe(rel) {
        return Resolved::BadRequest;
    }
    if rel.is_empty() {
        return Resolved::NotFound;
    }
    resolve_existing(root, &root.join(rel))
}

fn is_safe(rel: &str) -> bool {
    if rel.is_empty() {
        return true;
    }
    for component in Path::new(rel).components() {
        match component {
            Component::Normal(part) => {
                if part.to_str().map(|s| s.contains('\0')).unwrap_or(true) {
                    return false;
                }
            }
            // CurDir is harmless (`./foo`) — Path::join collapses it.
            Component::CurDir => {}
            // Anything else: ParentDir, RootDir, Prefix (Windows drive) — reject.
            _ => return false,
        }
    }
    true
}

fn resolve_existing(publish_root: &Path, candidate: &Path) -> Resolved {
    let canonical = match candidate.canonicalize() {
        Ok(c) => c,
        Err(_) => return Resolved::NotFound,
    };
    if !canonical.is_file() {
        return Resolved::NotFound;
    }
    let root_canonical = match publish_root.canonicalize() {
        Ok(c) => c,
        Err(_) => return Resolved::NotFound,
    };
    if !canonical.starts_with(&root_canonical) {
        return Resolved::NotFound;
    }
    Resolved::File(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_fixture() -> TempDir {
        let dir = TempDir::new().expect("tempdir");
        let root = dir.path();
        fs::create_dir_all(root.join("about")).unwrap();
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("index.html"), b"<h1>home</h1>").unwrap();
        fs::write(root.join("about").join("index.html"), b"<h1>about</h1>").unwrap();
        fs::write(root.join("assets").join("logo.svg"), b"<svg/>").unwrap();
        fs::write(root.join("pricing"), b"<h1>pricing flat</h1>").unwrap();
        dir
    }

    #[test]
    fn root_serves_index() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/");
        assert!(matches!(&r, Resolved::File(p) if p.ends_with("index.html")));
    }

    #[test]
    fn empty_path_serves_index() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "");
        assert!(matches!(&r, Resolved::File(p) if p.ends_with("index.html")));
    }

    #[test]
    fn direct_file_with_extension_served() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/assets/logo.svg");
        assert!(matches!(&r, Resolved::File(p) if p.ends_with("logo.svg")));
    }

    #[test]
    fn missing_asset_returns_not_found_not_spa() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/assets/missing.png");
        assert_eq!(r, Resolved::NotFound);
    }

    #[test]
    fn directory_index_html() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/about");
        assert!(
            matches!(&r, Resolved::File(p) if p.ends_with("about/index.html") || p.ends_with("about\\index.html"))
        );
    }

    #[test]
    fn directory_index_trailing_slash() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/about/");
        assert!(
            matches!(&r, Resolved::File(p) if p.ends_with("about/index.html") || p.ends_with("about\\index.html"))
        );
    }

    #[test]
    fn literal_file_preferred_over_directory_index() {
        let dir = setup_fixture();
        // /pricing is a literal file in the fixture
        let r = resolve(dir.path(), "/pricing");
        let Resolved::File(p) = r else {
            panic!("expected file, got {r:?}");
        };
        let body = fs::read_to_string(&p).unwrap();
        assert!(body.contains("pricing flat"));
    }

    #[test]
    fn spa_fallback_for_unknown_route_no_extension() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/some/unknown/page");
        assert!(matches!(&r, Resolved::File(p) if p.ends_with("index.html")));
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/../../etc/passwd");
        assert_eq!(r, Resolved::BadRequest);
    }

    #[test]
    fn rejects_encoded_parent_dir_traversal() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/%2e%2e/%2e%2e/etc/passwd");
        assert_eq!(r, Resolved::BadRequest);
    }

    #[test]
    fn rejects_null_byte() {
        let dir = setup_fixture();
        let r = resolve(dir.path(), "/index.html%00.png");
        assert_eq!(r, Resolved::BadRequest);
    }

    #[test]
    fn percent_decodes_safe_paths() {
        let dir = setup_fixture();
        fs::write(dir.path().join("with space.txt"), b"hi").unwrap();
        let r = resolve(dir.path(), "/with%20space.txt");
        assert!(matches!(&r, Resolved::File(_)));
    }

    #[test]
    fn strict_finds_existing_file() {
        let dir = setup_fixture();
        let r = resolve_strict(dir.path(), "/assets/logo.svg");
        assert!(matches!(&r, Resolved::File(p) if p.ends_with("logo.svg")));
    }

    #[test]
    fn strict_does_not_spa_fallback_on_extensionless_miss() {
        let dir = setup_fixture();
        // Existing `resolve` would 200 with index.html for this. Strict must
        // 404 — uploads / static assets are not React routes.
        let r = resolve_strict(dir.path(), "/no/such/page");
        assert_eq!(r, Resolved::NotFound);
    }

    #[test]
    fn strict_does_not_use_directory_index() {
        let dir = setup_fixture();
        // `about/` has index.html in the fixture. Existing `resolve` follows
        // it; strict must NOT (uploads dirs are not browsable).
        let r = resolve_strict(dir.path(), "/about/");
        assert_eq!(r, Resolved::NotFound);
    }

    #[test]
    fn strict_rejects_traversal() {
        let dir = setup_fixture();
        let r = resolve_strict(dir.path(), "/../../etc/passwd");
        assert_eq!(r, Resolved::BadRequest);
    }

    #[test]
    fn strict_empty_path_is_not_found() {
        let dir = setup_fixture();
        assert_eq!(resolve_strict(dir.path(), ""), Resolved::NotFound);
        assert_eq!(resolve_strict(dir.path(), "/"), Resolved::NotFound);
    }
}
