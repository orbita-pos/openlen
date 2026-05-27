pub mod redirect;
pub mod subdomain;

pub use redirect::run_http_redirect;
pub use subdomain::{extract_subdomain, is_openlen_zone, looks_like_public_hostname};
