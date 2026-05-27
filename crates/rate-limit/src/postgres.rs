//! Postgres sliding-window limiter — Phase D placeholder.

use sqlx::PgPool;

/// Postgres-backed sliding-window limiter. Replaces `lib/limits.ts`.
#[derive(Debug, Clone)]
pub struct PostgresLimiter {
    pool: PgPool,
}

impl PostgresLimiter {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}
