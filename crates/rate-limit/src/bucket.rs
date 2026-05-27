//! In-memory token bucket — Phase C placeholder. Real implementation lands
//! in Phase C; this stub exists so the workspace compiles after Phase B.

/// Sliding-window in-memory token bucket. Replaces `lib/rate-limit.ts`.
///
/// The Phase C implementation will hold a `DashMap<String, Bucket>`, a
/// continuous refill computation, and a background GC task. For now this
/// is a placeholder so other modules can name-reference it.
#[derive(Debug, Default)]
pub struct MemoryLimiter {
    _placeholder: (),
}

impl MemoryLimiter {
    pub fn new() -> Self {
        Self::default()
    }
}
