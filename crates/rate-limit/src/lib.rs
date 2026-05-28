//! OpenLen unified rate limiter.
//!
//! Replaces the four parallel TS limit modules (lib/rate-limit.ts,
//! lib/limits.ts, lib/analytics/rate-limit.ts, lib/subdomain/limits.ts) with
//! a single Rust engine exposing two storage backends and (optionally) a
//! hybrid that combines them.
//!
//! - [`bucket::MemoryLimiter`] — sync, in-memory token bucket (sliding
//!   window via continuous refill). Hot path: no allocation, no syscalls.
//!   Used by autofill (per-user) and the analytics beacon (per-IP).
//! - [`postgres::PostgresLimiter`] — async, Postgres-backed sliding window.
//!   Counts rows in `rate_limit_events` per window, inserts on allow.
//!   Used by /api/generate (per-user quota) and the auth/forms IP limits.
//! - [`hybrid::HybridLimiter`] — memory primary + lazy Postgres durability.
//!   Optional; not wired to a TS caller in this session (see handoff).
//!
//! Three public surfaces:
//!
//! - **Native Rust API** — `MemoryLimiter`, `PostgresLimiter`, supporting
//!   types in [`types`]. Used by other crates in this workspace and by
//!   Rust integration tests.
//! - **napi binding** ([`napi`]) — exposes a single `RateLimiter` class to
//!   JS with both `try_consume` (sync, memory) and `check_and_consume`
//!   (async, Postgres) methods. The TS wrapper at `lib/rate-limit-rs.ts`
//!   narrows the napi shape into ergonomic types for the four call-site
//!   shims (`lib/rate-limit.ts`, `lib/limits.ts`,
//!   `lib/analytics/rate-limit.ts`, `lib/subdomain/limits.ts`).

pub mod bucket;
pub mod error;
pub mod hybrid;
#[cfg(feature = "napi-bindings")]
pub mod napi;
pub mod postgres;
pub mod smart_cache;
pub mod types;

pub use bucket::MemoryLimiter;
pub use error::RateLimitError;
pub use hybrid::HybridLimiter;
pub use postgres::PostgresLimiter;
pub use smart_cache::{
    PersistenceMode, SmartCache, SmartCacheConfig, SmartCacheStats,
};
pub use types::{
    ConsumeOutcome, LimitDecision, LimitWindow, MemorySpec, RemainingWindow, UsageWindow,
};
