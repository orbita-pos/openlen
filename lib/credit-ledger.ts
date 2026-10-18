/**
 * THE SPEND LEDGER (spec local docs/superpowers/specs/2026-10-16-credit-ledger-design.md).
 *
 * One `creditLedger` row per movement of `users.credits`, written IN THE SAME
 * SQL STATEMENT that moves the balance, so the two can never drift apart — not
 * even with charges racing each other. Plus a row with 0 charged for work that
 * OpenLen pays without charging (the security review, a visitor's chat, a
 * publish translation, a turn that ended on an error).
 *
 * Each row says what was charged (`centicredits`), what the work was worth at the
 * billing rate before caps (`listCenticredits`) and what it really cost at the
 * cost rate (`costMicroUsd`, `lib/ai/cost-rates.ts`; null = unknown).
 *
 * Only `lib/credits.ts` calls the writers here: it owns the fallback for when the
 * ledger statement fails.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { tokenCostMicroUsd, unitCostMicroUsd, type CostProvider } from "@/lib/ai/cost-rates";
import { db } from "@/lib/db";

export type LedgerSurface =
  | "agent_turn"
  | "agent_tool"
  | "chat"
  | "autofill"
  | "image_edit"
  | "artifact_image"
  | "artifact_render"
  | "voice"
  | "app_ai"
  | "security_review"
  | "page_assistant"
  | "publish_translation";

export type LedgerOutcome = "ok" | "budget_limit" | "cancelled" | "error" | "refund" | "reserve" | "settle";

/** One paid use behind a row: a model call (tokens) or a unit-priced service. */
export interface LedgerUse {
  readonly provider: CostProvider;
  readonly model: string;
  readonly inputTokens?: number;
  /** A subset of `inputTokens`. */
  readonly cachedTokens?: number;
  readonly outputTokens?: number;
  /** A subset of `outputTokens`. */
  readonly reasoningTokens?: number;
  readonly images?: number;
  readonly seconds?: number;
  readonly queries?: number;
  /** When it ran, for the provider's time band. Defaults to now. */
  readonly at?: Date;
}

export interface LedgerEntry {
  readonly surface: LedgerSurface;
  readonly outcome: LedgerOutcome;
  readonly projectId?: string | null;
  /** Who asked, when it was not the payer (a member of a shared project). */
  readonly actorId?: string | null;
  readonly refId?: string | null;
  /** What the work was worth at the billing rate before caps and clamps. */
  readonly listCenticredits?: number | null;
  readonly uses?: readonly LedgerUse[];
}

export interface LedgerFields {
  readonly provider: string | null;
  readonly model: string | null;
  readonly inputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly costMicroUsd: number | null;
}

function hasTokens(u: LedgerUse): boolean {
  return u.inputTokens !== undefined || u.outputTokens !== undefined || u.cachedTokens !== undefined;
}

function costOfUse(u: LedgerUse): number | null {
  if (hasTokens(u)) {
    return tokenCostMicroUsd({
      provider: u.provider,
      model: u.model,
      inputTokens: u.inputTokens ?? 0,
      cachedTokens: u.cachedTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      at: u.at ?? new Date(),
    });
  }
  return unitCostMicroUsd({ provider: u.provider, model: u.model, images: u.images, seconds: u.seconds, queries: u.queries });
}

/** Sums one token field over the uses that report it; null if none does. */
function sumField(uses: readonly LedgerUse[], pick: (u: LedgerUse) => number | undefined): number | null {
  let total: number | null = null;
  for (const u of uses) {
    const v = pick(u);
    if (v !== undefined && Number.isFinite(v)) total = (total ?? 0) + v;
  }
  return total;
}

/** The row's provider, model, tokens and cost, from the entry's uses. The cost is
 *  null when there are no uses or any of them has no known price: a partial sum
 *  would read as the whole cost. */
export function ledgerFields(entry: LedgerEntry): LedgerFields {
  const uses = entry.uses ?? [];
  let cost: number | null = uses.length > 0 ? 0 : null;
  for (const u of uses) {
    const c = costOfUse(u);
    cost = cost === null || c === null ? null : cost + c;
  }
  return {
    provider: uses[0]?.provider ?? null,
    model: uses[0]?.model ?? null,
    inputTokens: sumField(uses, (u) => u.inputTokens),
    cachedTokens: sumField(uses, (u) => u.cachedTokens),
    outputTokens: sumField(uses, (u) => u.outputTokens),
    reasoningTokens: sumField(uses, (u) => u.reasoningTokens),
    costMicroUsd: cost,
  };
}

/** `db.execute` returns a node-postgres result (with `.rows`) or an array. */
function rows(r: unknown): Record<string, unknown>[] {
  return Array.isArray(r) ? r : ((r as { rows?: Record<string, unknown>[] }).rows ?? []);
}

/** The columns every row shares, as typed SQL values. Every parameter carries an
 *  explicit cast: in `INSERT … SELECT` Postgres types an untyped parameter as text. */
function rowValues(userId: string, entry: LedgerEntry) {
  const f = ledgerFields(entry);
  return {
    id: sql`${randomUUID()}::text`,
    userId: sql`${userId}::text`,
    actorId: sql`${entry.actorId ?? null}::text`,
    projectId: sql`${entry.projectId ?? null}::text`,
    surface: sql`${entry.surface}::text`,
    refId: sql`${entry.refId ?? null}::text`,
    listCenticredits: sql`${entry.listCenticredits ?? null}::integer`,
    costMicroUsd: sql`${f.costMicroUsd}::bigint`,
    provider: sql`${f.provider}::text`,
    model: sql`${f.model}::text`,
    inputTokens: sql`${f.inputTokens}::integer`,
    cachedTokens: sql`${f.cachedTokens}::integer`,
    outputTokens: sql`${f.outputTokens}::integer`,
    reasoningTokens: sql`${f.reasoningTokens}::integer`,
    outcome: sql`${entry.outcome}::text`,
  };
}

export type LedgerMovement = "clamp" | "if_enough" | "return";

/**
 * Moves the balance and writes its row in ONE statement:
 * - `clamp`: debit, clamped at 0 (the turn already ran);
 * - `if_enough`: debit only if the balance covers it, else nothing at all;
 * - `return`: credit back (the row's `centicredits` is negative).
 *
 * The row records what REALLY moved (`before − after`), so a clamped charge says
 * what it took, not what it asked for. `FOR UPDATE` serialises concurrent
 * charges on the account. Returns null when nothing moved (no such user, or not
 * enough balance for `if_enough`).
 */
export async function writeLedgerMovement(
  movement: LedgerMovement,
  userId: string,
  centicredits: number,
  entry: LedgerEntry,
): Promise<{ readonly moved: number; readonly balanceAfter: number } | null> {
  const v = rowValues(userId, entry);
  const amount = sql`${centicredits}::integer`;
  const update =
    movement === "clamp"
      ? sql`UPDATE "users" SET "credits" = GREATEST(0, "users"."credits" - ${amount}) FROM prev WHERE "users"."id" = ${v.userId}`
      : movement === "if_enough"
        ? sql`UPDATE "users" SET "credits" = "users"."credits" - ${amount} FROM prev WHERE "users"."id" = ${v.userId} AND "users"."credits" >= ${amount}`
        : sql`UPDATE "users" SET "credits" = "users"."credits" + ${amount} FROM prev WHERE "users"."id" = ${v.userId}`;
  const result = await db.execute(sql`
    WITH prev AS (
      SELECT "credits", "plan" FROM "users" WHERE "id" = ${v.userId} FOR UPDATE
    ), upd AS (
      ${update} RETURNING "users"."credits" AS after
    )
    INSERT INTO "creditLedger" (
      "id", "userId", "plan", "actorId", "projectId", "surface", "refId",
      "centicredits", "listCenticredits", "costMicroUsd", "provider", "model",
      "inputTokens", "cachedTokens", "outputTokens", "reasoningTokens", "balanceAfter", "outcome"
    )
    SELECT ${v.id}, ${v.userId}, prev."plan", ${v.actorId}, ${v.projectId}, ${v.surface}, ${v.refId},
      prev."credits" - upd.after, ${v.listCenticredits}, ${v.costMicroUsd}, ${v.provider}, ${v.model},
      ${v.inputTokens}, ${v.cachedTokens}, ${v.outputTokens}, ${v.reasoningTokens}, upd.after, ${v.outcome}
    FROM prev, upd
    RETURNING "centicredits", "balanceAfter"
  `);
  const [row] = rows(result);
  if (!row) return null;
  return { moved: Number(row.centicredits), balanceAfter: Number(row.balanceAfter) };
}

/** A row for work that did not move the balance (charged 0), with its cost. */
export async function writeLedgerUncharged(userId: string, entry: LedgerEntry): Promise<void> {
  const v = rowValues(userId, entry);
  await db.execute(sql`
    INSERT INTO "creditLedger" (
      "id", "userId", "plan", "actorId", "projectId", "surface", "refId",
      "centicredits", "listCenticredits", "costMicroUsd", "provider", "model",
      "inputTokens", "cachedTokens", "outputTokens", "reasoningTokens", "balanceAfter", "outcome"
    )
    SELECT ${v.id}, ${v.userId}, u."plan", ${v.actorId}, ${v.projectId}, ${v.surface}, ${v.refId},
      0, ${v.listCenticredits}, ${v.costMicroUsd}, ${v.provider}, ${v.model},
      ${v.inputTokens}, ${v.cachedTokens}, ${v.outputTokens}, ${v.reasoningTokens}, NULL, ${v.outcome}
    FROM "users" u WHERE u."id" = ${v.userId}
  `);
}

/** The SQLSTATE of an error the database server returned, or null. Drizzle wraps
 *  the driver's error in `cause`. A Node network error can carry a five-letter
 *  code too (`EPIPE`), so the server's `severity` is what tells them apart. */
export function serverErrorCode(err: unknown): string | null {
  for (const e of [err, (err as { cause?: unknown } | null)?.cause]) {
    const o = e as { code?: unknown; severity?: unknown } | null | undefined;
    if (o && typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code) && typeof o.severity === "string") return o.code;
  }
  return null;
}
