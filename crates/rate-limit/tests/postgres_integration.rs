//! Integration tests for the Postgres-backed limiter.
//!
//! Gated on `OPENLEN_RATE_LIMIT_TEST_DATABASE_URL` (or `DATABASE_URL` as a
//! fallback). When neither is set, every test logs a notice and returns
//! `Ok(())`. When set, the suite:
//!
//! 1. Connects via sqlx with `max_connections = 5`.
//! 2. Uses unique `key` prefixes per test (UUID-namespaced) so concurrent
//!    runs against the same database don't collide.
//! 3. Cleans up its own rows in a `cleanup` step keyed on the prefix.
//!
//! Run with: `cargo test -p openlen-rate-limit --test postgres_integration`.
//! Override the URL: `OPENLEN_RATE_LIMIT_TEST_DATABASE_URL=postgresql://... cargo test ...`.

use std::env;

use openlen_rate_limit::{LimitWindow, PostgresLimiter};
use sqlx::{Executor, PgPool, postgres::PgPoolOptions};

/// Connect if either env var is present. Returns `Ok(None)` to make tests
/// no-op when no test database is configured — keeps the suite green on
/// hosts without Postgres without manual `#[ignore]` toggling.
async fn try_connect() -> sqlx::Result<Option<PgPool>> {
    let url = env::var("OPENLEN_RATE_LIMIT_TEST_DATABASE_URL")
        .ok()
        .or_else(|| env::var("DATABASE_URL").ok())
        .filter(|s| !s.is_empty());
    let Some(url) = url else {
        eprintln!(
            "[postgres_integration] SKIP — set OPENLEN_RATE_LIMIT_TEST_DATABASE_URL to run"
        );
        return Ok(None);
    };
    let pool = PgPoolOptions::new().max_connections(5).connect(&url).await?;
    Ok(Some(pool))
}

/// Ensure the `rateLimitEvents` table exists — matches the Drizzle
/// migration shape. The migration is the source of truth; this is a
/// belt-and-braces for test hosts that may have a fresh DB.
async fn ensure_schema(pool: &PgPool) -> sqlx::Result<()> {
    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS "rateLimitEvents" (
            "id" text PRIMARY KEY NOT NULL,
            "key" text NOT NULL,
            "createdAt" timestamp NOT NULL DEFAULT now()
        )
        "#,
    )
    .await?;
    pool.execute(
        r#"
        CREATE INDEX IF NOT EXISTS "rateLimitEvents_key_createdAt_idx"
            ON "rateLimitEvents" USING btree ("key", "createdAt")
        "#,
    )
    .await?;
    Ok(())
}

/// Generate a unique key prefix for this test so concurrent test runs
/// don't share counters.
fn test_key(suffix: &str) -> String {
    format!("test:{}:{}", uuid::Uuid::new_v4().simple(), suffix)
}

async fn cleanup(pool: &PgPool, key: &str) {
    let _ = sqlx::query(r#"DELETE FROM "rateLimitEvents" WHERE "key" = $1"#)
        .bind(key)
        .execute(pool)
        .await;
}

#[tokio::test]
async fn check_and_consume_inserts_until_max() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("inserts");
    let limiter = PostgresLimiter::new(pool.clone());
    let windows = vec![LimitWindow {
        window_ms: 60_000,
        max: 3,
        label: "minute".into(),
    }];

    for i in 0..3 {
        let decision = limiter.check_and_consume(&key, &windows).await.unwrap();
        assert!(decision.ok, "consume #{i} should succeed");
    }
    let blocked = limiter.check_and_consume(&key, &windows).await.unwrap();
    assert!(!blocked.ok, "4th consume must be blocked");
    assert_eq!(blocked.blocked.as_ref().map(|w| &w.label), Some(&"minute".to_string()));
    assert!(blocked.reset_at.is_some(), "blocked decision must report reset_at");

    cleanup(&pool, &key).await;
    Ok(())
}

#[tokio::test]
async fn check_and_consume_reports_remaining_correctly() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("remaining");
    let limiter = PostgresLimiter::new(pool.clone());
    let windows = vec![LimitWindow {
        window_ms: 60_000,
        max: 5,
        label: "minute".into(),
    }];

    let d1 = limiter.check_and_consume(&key, &windows).await.unwrap();
    assert_eq!(d1.remaining[0].remaining, 4);
    let d2 = limiter.check_and_consume(&key, &windows).await.unwrap();
    assert_eq!(d2.remaining[0].remaining, 3);

    cleanup(&pool, &key).await;
    Ok(())
}

#[tokio::test]
async fn multi_window_blocks_on_first_breached() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("multi");
    let limiter = PostgresLimiter::new(pool.clone());
    // Two windows: hourly max 3, daily max 100. Burn through the hourly.
    let windows = vec![
        LimitWindow {
            window_ms: 60 * 60 * 1000,
            max: 3,
            label: "hourly".into(),
        },
        LimitWindow {
            window_ms: 24 * 60 * 60 * 1000,
            max: 100,
            label: "daily".into(),
        },
    ];
    for _ in 0..3 {
        assert!(limiter.check_and_consume(&key, &windows).await.unwrap().ok);
    }
    let blocked = limiter.check_and_consume(&key, &windows).await.unwrap();
    assert!(!blocked.ok);
    assert_eq!(blocked.blocked.unwrap().label, "hourly");

    cleanup(&pool, &key).await;
    Ok(())
}

#[tokio::test]
async fn get_usage_returns_zero_remaining_on_fresh_key() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("usage");
    let limiter = PostgresLimiter::new(pool.clone());
    let windows = vec![LimitWindow {
        window_ms: 60_000,
        max: 5,
        label: "minute".into(),
    }];

    let usage = limiter.get_usage(&key, &windows).await.unwrap();
    assert_eq!(usage.len(), 1);
    assert_eq!(usage[0].used, 0);
    assert_eq!(usage[0].remaining, 5);

    // Insert one and re-query.
    let _ = limiter.check_and_consume(&key, &windows).await.unwrap();
    let usage = limiter.get_usage(&key, &windows).await.unwrap();
    assert_eq!(usage[0].used, 1);
    assert_eq!(usage[0].remaining, 4);

    cleanup(&pool, &key).await;
    Ok(())
}

#[tokio::test]
async fn get_usage_does_not_insert() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("read-only");
    let limiter = PostgresLimiter::new(pool.clone());
    let windows = vec![LimitWindow {
        window_ms: 60_000,
        max: 5,
        label: "minute".into(),
    }];

    for _ in 0..50 {
        let _ = limiter.get_usage(&key, &windows).await.unwrap();
    }
    let usage = limiter.get_usage(&key, &windows).await.unwrap();
    assert_eq!(usage[0].used, 0, "get_usage must never insert");

    cleanup(&pool, &key).await;
    Ok(())
}

#[tokio::test]
async fn invalid_max_rejected_loudly() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    let limiter = PostgresLimiter::new(pool);
    let result = limiter
        .check_and_consume(
            "anything",
            &[LimitWindow {
                window_ms: 1_000,
                max: 0,
                label: "bad".into(),
            }],
        )
        .await;
    assert!(result.is_err(), "max=0 must reject");
    Ok(())
}
