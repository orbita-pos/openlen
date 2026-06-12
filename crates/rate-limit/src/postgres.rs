//! Postgres-backed sliding-window limiter — port of
//! `lib/limits.ts::checkAndConsume` / `getUsage`.
//!
//! ## Storage shape
//!
//! Backed by the existing `"rateLimitEvents"` table (Drizzle migration
//! `0002_colorful_spiral.sql` — quoted identifiers preserved):
//!
//! ```sql
//! CREATE TABLE "rateLimitEvents" (
//!   "id"        text PRIMARY KEY NOT NULL,
//!   "key"       text NOT NULL,
//!   "createdAt" timestamp NOT NULL DEFAULT now()
//! );
//! CREATE INDEX "rateLimitEvents_key_createdAt_idx"
//!   ON "rateLimitEvents" USING btree ("key", "createdAt");
//! ```
//!
//! Each `check_and_consume` call runs one `SELECT COUNT(*)` per window
//! against the index, finds the first window where count >= max, fetches
//! the oldest still-live event (to compute `reset_at`), and `INSERT`s a
//! new row when allowed. **No transaction** — matches the TS comment:
//! > "Two concurrent requests right at the limit might both pass —
//! > acceptable slop for a quota system, not for a money-critical lock."
//!
//! ## Why we don't run windows in parallel
//!
//! `lib/limits.ts` uses `Promise.all` to count windows concurrently. We
//! intentionally do them sequentially in Rust: the typical call hits 1-2
//! windows (max 2 today, see `IP_LIMITS`), sqlx pool acquire is a few
//! microseconds, and serial keeps the code obvious. If we ever ship a
//! caller with 5+ windows we can add `futures::try_join_all`.

use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::RateLimitError;
use crate::types::{LimitDecision, LimitWindow, RemainingWindow, UsageWindow};

/// SQL strings live as `pub(crate) const` so the unit tests can assert
/// the shape (quoted identifiers, positional binds) without spinning up
/// a database.
pub(crate) const COUNT_SQL: &str =
    r#"SELECT COUNT(*)::bigint FROM "rateLimitEvents" WHERE "key" = $1 AND "createdAt" > $2"#;

// The column is `timestamp without time zone` (Drizzle's default — the values
// are UTC wall time from `DEFAULT now()` on a UTC server), and sqlx decodes
// `DateTime<Utc>` ONLY from TIMESTAMPTZ. The cast reinterprets the naive
// value as UTC in SQL; without it, every BLOCKED decision — the only path
// that reads this column back — failed with "mismatched types" and callers
// 500'd instead of returning a clean 429 with resetAt.
pub(crate) const OLDEST_SQL: &str = r#"SELECT ("createdAt" AT TIME ZONE 'UTC') FROM "rateLimitEvents" WHERE "key" = $1 AND "createdAt" > $2 ORDER BY "createdAt" LIMIT 1"#;

pub(crate) const INSERT_SQL: &str =
    r#"INSERT INTO "rateLimitEvents" ("id", "key") VALUES ($1, $2)"#;

/// Postgres-backed limiter. Cheap to clone — the inner `PgPool` is
/// reference-counted by sqlx.
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

    /// Connect using a libpq-style URL (`postgresql://...`). The resulting
    /// pool defaults to a max of 5 connections — generous for the
    /// rate-limit workload (one query per `check_and_consume`, count
    /// pattern is index-bound).
    pub async fn connect(database_url: &str) -> Result<Self, RateLimitError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        Ok(Self::new(pool))
    }

    /// Count events per window, decide if any window is breached, insert
    /// a new event when allowed. See module docs for the concurrency
    /// trade-off.
    pub async fn check_and_consume(
        &self,
        key: &str,
        windows: &[LimitWindow],
    ) -> Result<LimitDecision, RateLimitError> {
        validate_windows(windows)?;

        let mut counts: Vec<(LimitWindow, u32)> = Vec::with_capacity(windows.len());
        for w in windows {
            let since = Utc::now() - chrono_duration_from_ms(w.window_ms);
            let row: (i64,) = sqlx::query_as(COUNT_SQL)
                .bind(key)
                .bind(since)
                .fetch_one(&self.pool)
                .await?;
            let count = i64_to_u32(row.0);
            counts.push((w.clone(), count));
        }

        if let Some((blocked_window, _)) = counts.iter().find(|(w, c)| *c >= w.max).cloned() {
            let since = Utc::now() - chrono_duration_from_ms(blocked_window.window_ms);
            let oldest: Option<(DateTime<Utc>,)> = sqlx::query_as(OLDEST_SQL)
                .bind(key)
                .bind(since)
                .fetch_optional(&self.pool)
                .await?;
            let reset_at = Some(match oldest {
                Some((t,)) => t + chrono_duration_from_ms(blocked_window.window_ms),
                None => Utc::now() + chrono_duration_from_ms(blocked_window.window_ms),
            });

            return Ok(LimitDecision {
                ok: false,
                blocked: Some(blocked_window),
                reset_at,
                remaining: counts
                    .into_iter()
                    .map(|(w, c)| RemainingWindow {
                        remaining: w.max.saturating_sub(c),
                        window: w,
                    })
                    .collect(),
            });
        }

        // Generate the UUID app-side so the column stays plain `text` (the
        // existing schema has no Postgres default — Drizzle emits the
        // UUID in JS via `$defaultFn`, and we mirror that).
        let id = Uuid::new_v4().to_string();
        sqlx::query(INSERT_SQL)
            .bind(&id)
            .bind(key)
            .execute(&self.pool)
            .await?;

        Ok(LimitDecision {
            ok: true,
            blocked: None,
            reset_at: None,
            remaining: counts
                .into_iter()
                .map(|(w, c)| {
                    let remaining = w.max.saturating_sub(c.saturating_add(1));
                    RemainingWindow {
                        remaining,
                        window: w,
                    }
                })
                .collect(),
        })
    }

    /// Read-only counterpart — `getUsage` in the TS module. Used by
    /// `/api/usage` and any UI element that surfaces remaining quota.
    pub async fn get_usage(
        &self,
        key: &str,
        windows: &[LimitWindow],
    ) -> Result<Vec<UsageWindow>, RateLimitError> {
        validate_windows(windows)?;
        let mut out = Vec::with_capacity(windows.len());
        for w in windows {
            let since = Utc::now() - chrono_duration_from_ms(w.window_ms);
            let row: (i64,) = sqlx::query_as(COUNT_SQL)
                .bind(key)
                .bind(since)
                .fetch_one(&self.pool)
                .await?;
            let used = i64_to_u32(row.0);
            out.push(UsageWindow {
                window: w.clone(),
                used,
                remaining: w.max.saturating_sub(used),
            });
        }
        Ok(out)
    }
}

fn validate_windows(windows: &[LimitWindow]) -> Result<(), RateLimitError> {
    for w in windows {
        if w.max == 0 {
            return Err(RateLimitError::InvalidMax(0));
        }
        if w.window_ms == 0 {
            return Err(RateLimitError::InvalidWindow);
        }
    }
    Ok(())
}

fn chrono_duration_from_ms(ms: u64) -> Duration {
    // i64::MAX ms ≈ 292 million years — no realistic overflow path. The
    // `as i64` cast saturates at i64::MAX on extreme inputs.
    Duration::milliseconds(ms.min(i64::MAX as u64) as i64)
}

fn i64_to_u32(n: i64) -> u32 {
    if n < 0 {
        0
    } else if n > u32::MAX as i64 {
        u32::MAX
    } else {
        n as u32
    }
}

#[cfg(test)]
mod tests {
    //! SQL-shape unit tests only — the integration tests in
    //! `tests/postgres_integration.rs` exercise the full path against a
    //! real Postgres when `OPENLEN_RATE_LIMIT_TEST_DATABASE_URL` is set.

    use super::*;
    use crate::types::LimitWindow;

    #[test]
    fn count_sql_uses_quoted_identifiers_and_positional_binds() {
        assert!(COUNT_SQL.contains(r#""rateLimitEvents""#));
        assert!(COUNT_SQL.contains(r#""key""#));
        assert!(COUNT_SQL.contains(r#""createdAt""#));
        assert!(COUNT_SQL.contains("$1"));
        assert!(COUNT_SQL.contains("$2"));
        assert!(COUNT_SQL.to_uppercase().contains("COUNT(*)::BIGINT"));
    }

    #[test]
    fn oldest_sql_orders_and_limits_one() {
        assert!(OLDEST_SQL.to_uppercase().contains("ORDER BY"));
        assert!(OLDEST_SQL.to_uppercase().contains("LIMIT 1"));
        assert!(OLDEST_SQL.contains(r#""createdAt""#));
        // The decode target is DateTime<Utc> (TIMESTAMPTZ) but the column is
        // a naive timestamp — the UTC reinterpretation cast is load-bearing.
        assert!(OLDEST_SQL.contains("AT TIME ZONE 'UTC'"));
    }

    #[test]
    fn insert_sql_binds_both_id_and_key() {
        assert!(INSERT_SQL.contains(r#""rateLimitEvents""#));
        assert!(INSERT_SQL.contains(r#""id""#));
        assert!(INSERT_SQL.contains(r#""key""#));
        assert!(INSERT_SQL.contains("$1"));
        assert!(INSERT_SQL.contains("$2"));
    }

    #[test]
    fn chrono_duration_from_ms_matches_for_hour() {
        let d = chrono_duration_from_ms(3_600_000);
        assert_eq!(d.num_seconds(), 3_600);
    }

    #[test]
    fn chrono_duration_from_ms_saturates_huge_input() {
        // i64::MAX ms — confirms the saturating cast doesn't panic.
        let d = chrono_duration_from_ms(u64::MAX);
        assert!(d.num_milliseconds() > 0);
    }

    #[test]
    fn i64_to_u32_clamps_negative_to_zero() {
        assert_eq!(i64_to_u32(-1), 0);
    }

    #[test]
    fn i64_to_u32_clamps_huge_positive_to_u32_max() {
        assert_eq!(i64_to_u32((u32::MAX as i64) + 1), u32::MAX);
    }

    #[test]
    fn i64_to_u32_passes_through_normal_count() {
        assert_eq!(i64_to_u32(42), 42);
    }

    #[test]
    fn validate_windows_rejects_zero_max() {
        let windows = vec![LimitWindow {
            window_ms: 1_000,
            max: 0,
            label: "bad".into(),
        }];
        assert!(matches!(
            validate_windows(&windows),
            Err(RateLimitError::InvalidMax(0))
        ));
    }

    #[test]
    fn validate_windows_rejects_zero_window() {
        let windows = vec![LimitWindow {
            window_ms: 0,
            max: 5,
            label: "bad".into(),
        }];
        assert!(matches!(
            validate_windows(&windows),
            Err(RateLimitError::InvalidWindow)
        ));
    }

    #[test]
    fn validate_windows_accepts_normal_input() {
        let windows = vec![LimitWindow {
            window_ms: 3_600_000,
            max: 5,
            label: "hourly".into(),
        }];
        assert!(validate_windows(&windows).is_ok());
    }
}
