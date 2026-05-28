//! Tower middleware for the edge router.
//!
//! Layers added here run before [`crate::server::serve_or_proxy`] sees the
//! request. The rate-limit module is the only inhabitant today; future
//! cross-cutting concerns (request-id injection, body-size cap) would land
//! here too.

pub mod rate_limit;

pub use rate_limit::{
    extract_client_ip, ClientIpSource, IpExtractConfig, RateLimitConfig, RateLimitLayer,
    RateLimitMiddleware,
};
