// The four names DeepSeek's schedule domain takes from `@deepseek-ai/dsh-session`, as small as they
// can be. OpenLen has no DeepSeek sessions: its tasks live in Postgres (lib/scheduled-tasks/store.ts),
// and the session-log fold these feed (`foldScheduleEvents`) is upstream code OpenLen never calls —
// it stays so upstream's tests port unchanged.

/** Count of events inherited from a parent session's log. */
export type SessionLogOffset = number & { readonly __sessionLogOffset: true }
export const SessionLogOffset = (value: number): SessionLogOffset => value as SessionLogOffset

/** Position of an event in a session's log. */
export type SessionSeq = number & { readonly __sessionSeq: true }
export const SessionSeq = (value: number): SessionSeq => value as SessionSeq

/** A session id; only named by types the domain does not use. */
export type SessionId = string & { readonly __sessionId: true }

/** One durable event in a session's log, as far as the fold reads it. */
export interface SessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}
