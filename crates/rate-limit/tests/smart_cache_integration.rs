//! Integration tests for the SmartCache, gated on a real Postgres URL.
//!
//! Same gating as `postgres_integration.rs` — set
//! `OPENLEN_RATE_LIMIT_TEST_DATABASE_URL` (or `DATABASE_URL`) to a writable
//! Postgres with the `rateLimitEvents` schema. Without it, every test
//! logs a SKIP notice and returns `Ok(())`.

use std::env;
use std::time::Duration;

use openlen_rate_limit::{LimitWindow, PersistenceMode, SmartCache, SmartCacheConfig};
use sqlx::{postgres::PgPoolOptions, Executor, PgPool};

async fn try_connect() -> sqlx::Result<Option<PgPool>> {
    let url = env::var("OPENLEN_RATE_LIMIT_TEST_DATABASE_URL")
        .ok()
        .or_else(|| env::var("DATABASE_URL").ok())
        .filter(|s| !s.is_empty());
    let Some(url) = url else {
        eprintln!(
            "[smart_cache_integration] SKIP — set OPENLEN_RATE_LIMIT_TEST_DATABASE_URL to run"
        );
        return Ok(None);
    };
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await?;
    Ok(Some(pool))
}

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

fn test_key(suffix: &str) -> String {
    format!("smart:{}:{}", uuid::Uuid::new_v4().simple(), suffix)
}

async fn cleanup(pool: &PgPool, key: &str) {
    let _ = sqlx::query(r#"DELETE FROM "rateLimitEvents" WHERE "key" = $1"#)
        .bind(key)
        .execute(pool)
        .await;
}

async fn count_events(pool: &PgPool, key: &str) -> i64 {
    let row: (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*)::bigint FROM "rateLimitEvents" WHERE "key" = $1"#)
            .bind(key)
            .fetch_one(pool)
            .await
            .unwrap();
    row.0
}

#[tokio::test]
async fn flush_loop_persists_allowed_events() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("flush");

    let cfg = SmartCacheConfig {
        persistence_mode: PersistenceMode::AllEvents,
        flush_interval: Duration::from_millis(100),
        flush_batch_max: 50,
        flush_queue_capacity: 1000,
        ..SmartCacheConfig::default()
    };
    let (cache, _bg) = SmartCache::start_with_pool(pool.clone(), cfg);
    let windows = vec![LimitWindow {
        window_ms: 60_000,
        max: 10,
        label: "minute".into(),
    }];

    for _ in 0..5 {
        let dec = cache.check_and_consume(&key, &windows).await.unwrap();
        assert!(dec.ok);
    }

    // Wait for at least one flush interval to elapse.
    tokio::time::sleep(Duration::from_millis(400)).await;

    let persisted = count_events(&pool, &key).await;
    assert_eq!(persisted, 5, "all 5 allowed events should land in PG");
    assert_eq!(cache.stats().persisted(), 5, "stats counter matches DB");

    cleanup(&pool, &key).await;
    Ok(())
}

#[tokio::test]
async fn blocked_events_do_not_persist() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("blocked");

    let cfg = SmartCacheConfig {
        persistence_mode: PersistenceMode::AllEvents,
        flush_interval: Duration::from_millis(100),
        ..SmartCacheConfig::default()
    };
    let (cache, _bg) = SmartCache::start_with_pool(pool.clone(), cfg);
    let windows = vec![LimitWindow {
        window_ms: 60_000,
        max: 2,
        label: "minute".into(),
    }];

    for _ in 0..2 {
        assert!(cache.check_and_consume(&key, &windows).await.unwrap().ok);
    }
    // Burst beyond the limit — none of these should reach PG.
    for _ in 0..10 {
        let dec = cache.check_and_consume(&key, &windows).await.unwrap();
        assert!(!dec.ok);
    }

    tokio::time::sleep(Duration::from_millis(400)).await;
    let persisted = count_events(&pool, &key).await;
    assert_eq!(persisted, 2, "blocked decisions must not enqueue PG writes");
    assert_eq!(cache.stats().persisted(), 2);
    assert_eq!(cache.stats().block(), 10);

    cleanup(&pool, &key).await;
    Ok(())
}

#[tokio::test]
async fn hydration_seeds_memory_from_recent_pg_rows() -> sqlx::Result<()> {
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("hydrate");

    // Pre-populate PG with 4 events for this key, all in the past minute.
    for _ in 0..4 {
        sqlx::query(r#"INSERT INTO "rateLimitEvents" ("id", "key") VALUES ($1, $2)"#)
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(&key)
            .execute(&pool)
            .await?;
    }

    // Boot a fresh SmartCache and hydrate against the 1-minute window.
    let (cache, _bg) = SmartCache::start_with_pool(
        pool.clone(),
        SmartCacheConfig {
            persistence_mode: PersistenceMode::None, // hydrate-only; no flush
            ..SmartCacheConfig::default()
        },
    );
    let windows = vec![LimitWindow {
        window_ms: 60_000,
        max: 5,
        label: "minute".into(),
    }];
    let seeded = cache.hydrate(&windows).await.unwrap();
    assert!(
        seeded >= 1,
        "at least one (key, window) pair must be seeded"
    );
    assert!(cache.stats().seeded() >= 1);

    // After hydration the memory bucket is at max - 4 = 1 token. One
    // consume passes, the second blocks.
    assert!(cache.check_and_consume(&key, &windows).await.unwrap().ok);
    let blocked = cache.check_and_consume(&key, &windows).await.unwrap();
    assert!(
        !blocked.ok,
        "hydrated bucket should already be at the limit"
    );

    cleanup(&pool, &key).await;
    Ok(())
}

#[tokio::test]
async fn check_and_consume_does_not_block_on_pg_round_trip() -> sqlx::Result<()> {
    // Memory-only: even though we pass a pool, persistence_mode = None
    // means check_and_consume must never await PG. The wall-clock budget
    // is therefore microseconds, not the PG round-trip latency.
    let Some(pool) = try_connect().await? else {
        return Ok(());
    };
    ensure_schema(&pool).await?;
    let key = test_key("non_blocking");

    let (cache, _bg) = SmartCache::start_with_pool(
        pool.clone(),
        SmartCacheConfig {
            persistence_mode: PersistenceMode::None,
            ..SmartCacheConfig::default()
        },
    );
    let windows = vec![LimitWindow {
        window_ms: 60_000,
        max: 1000,
        label: "minute".into(),
    }];

    let started = std::time::Instant::now();
    for _ in 0..100 {
        let _ = cache.check_and_consume(&key, &windows).await.unwrap();
    }
    let elapsed = started.elapsed();
    // 100 memory-bucket checks should land well under 50 ms on any host;
    // this assertion mostly guards against accidentally awaiting the pool.
    assert!(
        elapsed < Duration::from_millis(500),
        "100 memory-only consumes took {elapsed:?} — suspiciously slow"
    );

    cleanup(&pool, &key).await;
    Ok(())
}
