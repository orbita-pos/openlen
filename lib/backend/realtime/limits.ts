// Los límites de Realtime por proyecto: los de Supabase por defecto
// (supabase/realtime @ f86df8c3, Apache-2.0: config/runtime.exs y
// lib/realtime/api/tenant.ex), cambiables con PAGES_REALTIME_*.

export interface RealtimeLimits {
  /** TENANT_MAX_CONCURRENT_USERS: sockets a la vez por proyecto. */
  readonly maxConcurrentUsers: number;
  /** TENANT_MAX_EVENTS_PER_SECOND. */
  readonly maxEventsPerSecond: number;
  /** TENANT_MAX_JOINS_PER_SECOND. */
  readonly maxJoinsPerSecond: number;
  /** TENANT_MAX_CHANNELS_PER_CLIENT. */
  readonly maxChannelsPerClient: number;
  /** `max_payload_size_in_kb` (3.000). */
  readonly maxPayloadSizeKb: number;
  /** `max_presence_events_per_second` (1.000). */
  readonly maxPresenceEventsPerSecond: number;
  /** `client_presence_rate_limit`: 5 `track` cada 30 s por cliente. */
  readonly clientPresenceMaxCalls: number;
  readonly clientPresenceWindowMs: number;
}

export const DEFAULT_REALTIME_LIMITS: RealtimeLimits = {
  maxConcurrentUsers: 200,
  maxEventsPerSecond: 100,
  maxJoinsPerSecond: 100,
  maxChannelsPerClient: 100,
  maxPayloadSizeKb: 3000,
  maxPresenceEventsPerSecond: 1000,
  clientPresenceMaxCalls: 5,
  clientPresenceWindowMs: 30_000,
};

function positive(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Los del entorno, con los de Supabase por defecto. */
export function realtimeLimits(env: NodeJS.ProcessEnv = process.env): RealtimeLimits {
  const d = DEFAULT_REALTIME_LIMITS;
  return {
    maxConcurrentUsers: positive(env.PAGES_REALTIME_MAX_CONCURRENT_USERS, d.maxConcurrentUsers),
    maxEventsPerSecond: positive(env.PAGES_REALTIME_MAX_EVENTS_PER_SECOND, d.maxEventsPerSecond),
    maxJoinsPerSecond: positive(env.PAGES_REALTIME_MAX_JOINS_PER_SECOND, d.maxJoinsPerSecond),
    maxChannelsPerClient: positive(env.PAGES_REALTIME_MAX_CHANNELS_PER_CLIENT, d.maxChannelsPerClient),
    maxPayloadSizeKb: positive(env.PAGES_REALTIME_MAX_PAYLOAD_SIZE_KB, d.maxPayloadSizeKb),
    maxPresenceEventsPerSecond: positive(env.PAGES_REALTIME_MAX_PRESENCE_EVENTS_PER_SECOND, d.maxPresenceEventsPerSecond),
    clientPresenceMaxCalls: d.clientPresenceMaxCalls,
    clientPresenceWindowMs: d.clientPresenceWindowMs,
  };
}

/** Su `@payload_size_padding`. */
const PAYLOAD_SIZE_PADDING = 500;

/** Su `validate_payload_size`. Ellos miden el término de Erlang
 *  (`:erlang.external_size`); aquí, los bytes del JSON o de la carga binaria. */
export function payloadTooLarge(bytes: number, limits: RealtimeLimits): boolean {
  return bytes > limits.maxPayloadSizeKb * 1000 + PAYLOAD_SIZE_PADDING;
}
