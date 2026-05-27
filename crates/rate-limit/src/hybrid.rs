//! Hybrid memory+Postgres limiter — Phase E placeholder.
//!
//! The Phase E implementation will layer a memory-primary cache over the
//! Postgres limiter for fast-path allows + durable cross-restart counts.

use crate::{bucket::MemoryLimiter, postgres::PostgresLimiter};

#[derive(Debug)]
pub struct HybridLimiter {
    _memory: MemoryLimiter,
    _persistent: PostgresLimiter,
}

impl HybridLimiter {
    pub fn new(memory: MemoryLimiter, persistent: PostgresLimiter) -> Self {
        Self {
            _memory: memory,
            _persistent: persistent,
        }
    }
}
