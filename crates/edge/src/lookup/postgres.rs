//! Postgres-backed [`DomainLookup`]. Uses a pooled sqlx connection to issue a
//! single JOIN per cache miss.
//!
//! Schema (Drizzle-generated, mixed-case identifiers MUST be double-quoted):
//!
//! ```sql
//! CREATE TABLE "customDomains" (
//!     id text PRIMARY KEY,
//!     "projectId" text NOT NULL REFERENCES projects(id),
//!     domain text UNIQUE NOT NULL,
//!     "verificationToken" text NOT NULL,
//!     "verifiedAt" timestamp,
//!     "createdAt" timestamp NOT NULL DEFAULT now(),
//!     "updatedAt" timestamp NOT NULL DEFAULT now()
//! );
//! CREATE TABLE projects (id text PRIMARY KEY, subdomain text UNIQUE, ...);
//! ```
//!
//! Lookup query: return `subdomain` for a host that has a verified custom
//! domain claim pointing at a project that has been published (i.e. has a
//! non-null `subdomain`). If multiple rows match, we take the most recently
//! verified — but `customDomains.domain` is UNIQUE, so there's at most one.

use std::time::Duration;

use async_trait::async_trait;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
use tracing::warn;

use super::{DomainLookup, LookupError, LookupResult};

const LOOKUP_SQL: &str = r#"
    SELECT p.subdomain
    FROM "customDomains" d
    JOIN projects p ON p.id = d."projectId"
    WHERE d.domain = $1 AND d."verifiedAt" IS NOT NULL
    LIMIT 1
"#;

#[derive(Debug, Clone)]
pub struct PostgresDomainLookup {
    pool: PgPool,
}

impl PostgresDomainLookup {
    /// Connect to Postgres, set `max_connections`, run a SELECT 1 healthcheck.
    /// Returns `LookupError::Postgres` on any connection / handshake failure.
    pub async fn connect(database_url: &str, max_connections: u32) -> Result<Self, LookupError> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(5))
            .connect(database_url)
            .await
            .map_err(|e| LookupError::Postgres(format!("connect: {e}")))?;

        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| LookupError::Postgres(format!("healthcheck: {e}")))?;

        Ok(Self { pool })
    }

    /// Build a Postgres lookup from an already-constructed pool. Tests that
    /// inject a pool against a real Postgres branch use this.
    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

#[async_trait]
impl DomainLookup for PostgresDomainLookup {
    async fn lookup(&self, host: &str) -> LookupResult {
        let row_opt = sqlx::query(LOOKUP_SQL)
            .bind(host)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| {
                let msg = e.to_string();
                warn!(%host, error = %msg, "postgres lookup query failed");
                LookupError::Postgres(msg)
            })?;

        let sub: Option<String> = match row_opt {
            None => None,
            Some(row) => row
                .try_get::<Option<String>, _>("subdomain")
                .map_err(|e| LookupError::Postgres(format!("decode subdomain: {e}")))?,
        };
        Ok(sub)
    }
}

#[cfg(test)]
mod tests {
    //! Unit tests for the SQL-shape are limited to compile-time string checks
    //! because a real Postgres handshake isn't available in unit tests. The
    //! `tests/lookup.rs` integration suite gates DB-backed tests on the
    //! `DATABASE_URL` env var and is skipped otherwise.

    use super::*;

    #[test]
    fn lookup_sql_uses_quoted_identifiers() {
        assert!(LOOKUP_SQL.contains(r#""customDomains""#));
        assert!(LOOKUP_SQL.contains(r#""projectId""#));
        assert!(LOOKUP_SQL.contains(r#""verifiedAt" IS NOT NULL"#));
    }

    #[test]
    fn lookup_sql_binds_via_positional_param() {
        assert!(LOOKUP_SQL.contains("$1"));
    }

    #[test]
    fn lookup_sql_caps_result_to_one_row() {
        assert!(LOOKUP_SQL.contains("LIMIT 1"));
    }
}
