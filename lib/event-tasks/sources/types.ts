// WHAT A SOURCE IS (spec local 2026-11-03-len-que-avisa, §7.2): code with one owner, as DeepSeek's source
// providers. It observes, reports what changed (a subject, a line, the detail, a link) and declares the schema
// of the parameters a task can set; the trigger decides whether a change matters, and only then a model looks.
import type { z } from "zod";

import type { EventSourceKind } from "../store";

/** One change of a source. `subject` groups changes: a table, or a form. `detail` is visitor data: never instructions. */
export interface SourceChange {
  readonly subject: string;
  readonly summary: string;
  readonly detail: Record<string, unknown>;
  readonly link?: string;
  /** When it happened, ISO. */
  readonly at: string;
}

export interface Observation<S> {
  readonly state: S;
  readonly changes: readonly SourceChange[];
}

export type ConditionOp = "eq" | "neq" | "contains" | "gt" | "lt" | "exists";

/** A task's condition on a field of a change, matched in TypeScript (never put in SQL). */
export interface Condition {
  readonly field: string;
  readonly op: ConditionOp;
  readonly value?: string | number;
}

/** A field of the source that must equal a value: how the judge finds older items related to a change. */
export interface SourceMatch {
  readonly field: string;
  readonly value: string;
}

/** Items a `match` read returns at most, newest first. */
export const MATCHING_MAX = 50;

/** A source failed in a way the owner can understand: its `reason` is a record's reason. */
export class SourceError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

export interface EventSource<P, S> {
  readonly kind: EventSourceKind;
  /** Its parameters' schema (./declarations.ts, shared with `schedule_create`'s `on`). */
  readonly paramsSchema: z.ZodType<P>;
  /** Whether a task can watch this, and its first state: what exists now never fires. */
  validate(projectId: string, params: P): Promise<{ ok: true; initialState: S } | { ok: false; reason: string }>;
  observe(projectId: string, params: P, state: S): Promise<Observation<S>>;
  /** The judge's read: the candidate's items, the newest before them, and — with `match` — the items whose fields
   *  equal those values, however old (Task 13: a clash with a booking from before the task). */
  read(projectId: string, params: P, args: { readonly keys: readonly string[]; readonly state: S; readonly match?: readonly SourceMatch[] }): Promise<unknown>;
}
