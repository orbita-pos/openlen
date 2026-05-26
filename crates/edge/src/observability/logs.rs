use std::env;

use tracing_subscriber::{fmt, prelude::*, EnvFilter};

const ENV_FORMAT: &str = "OPENLEN_EDGE_LOG_FORMAT";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Json,
    Pretty,
}

impl LogFormat {
    fn from_env() -> Self {
        match env::var(ENV_FORMAT).ok().as_deref() {
            Some("pretty") => Self::Pretty,
            _ => Self::Json,
        }
    }
}

/// Initialize tracing. Returns `true` if this call installed the global
/// subscriber, `false` if one was already set (e.g. another test installed it).
pub fn try_init_logs() -> bool {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,openlen_edge=info"));

    let registry = tracing_subscriber::registry().with(filter);

    match LogFormat::from_env() {
        LogFormat::Json => registry
            .with(fmt::layer().json().with_current_span(true))
            .try_init()
            .is_ok(),
        LogFormat::Pretty => registry
            .with(fmt::layer().with_target(true))
            .try_init()
            .is_ok(),
    }
}
