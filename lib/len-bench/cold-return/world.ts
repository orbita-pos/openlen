// THE REAL WORLD of the return bench: the route of the bench's local server, its database, and the provider
// for the one call the bench makes itself (the summary). What happens and in which order is ./runner.ts;
// here is only how each thing is done.
//
// 🔴 Only against a LOCAL database (`startBench` asks the server of the database where it answers from) and
// with everything that could reach a production service switched off in this process, as every Len-Bench
// runner does (lib/len-bench/entorno.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { COLD_TRIM_MARK } from "@/lib/agent/cold-return";
import { estimateTokens } from "@/lib/agent/compaction/estimate";
import { runIdleSummary } from "@/lib/agent/idle-summary";
import { idleSummaryCaptureFile } from "@/lib/agent/idle-summary-capture";
import { idleSummaryJobFor, type IdleSummaryJobInput } from "@/lib/agent/idle-summary-job";
import { WHOLE_HISTORY, historialDesdeLaBase } from "@/lib/agent/transcripcion";
import { assistantConversationKey } from "@/lib/assistants/conversation";
import { createAssistant } from "@/lib/assistants/store";
import { db, schema } from "@/lib/db";
import { DEFAULT_LOOK } from "@/lib/figure/look";
import { DIR_WEB, apagarEnEsteProceso, exigirBaseLocal } from "@/lib/len-bench/entorno";
import { identidadDeEval } from "@/lib/len-bench/eval-identity";
import { createThrowawayProject, deleteThrowawayProject } from "@/lib/len-bench/proyecto-de-eval";
import { acunarCookie, comprobarSesion, enviarTurno, textoDeLen } from "@/lib/len-bench/sesion";
import { ficheroDeLaWeb, webASerializable } from "@/lib/len-bench/web-sustituta";
import { turnosParaElHistorial } from "@/lib/projects/chat";
import { lowerBalance, openBalance } from "./balance";
import type { TokenUsage } from "./cost";
import type { Target, World } from "./runner";
import { ageConversation, restoreSnapshot, saveSnapshot, type Sql } from "./snapshot";
import { PAUSE_MS, benchIdleMinTokens, capturesDir, jobFile } from "./store";

const ZONE = "America/Mexico_City";

/** A pool as one connection's worth of SQL, with its transactions on a single client. */
export function poolSql(pool: Pool): Sql {
  const run =
    (q: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Sql["query"] =>
    async (text, params) =>
      (await q.query(text, params ? [...params] : undefined)).rows as never;
  return {
    query: run(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: run(client) });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export interface BenchSession {
  readonly owner: { readonly id: string; readonly email: string };
  readonly cookie: string;
  readonly sql: Sql;
  /** The server's lock: the owner's balance is set to what this command may spend (./balance.ts). */
  open(usd: number): Promise<void>;
  /** Leaves the balance at zero and lets go of the database. */
  close(): Promise<void>;
}

/**
 * What a paid command does before its first turn: switches off what would reach production, demands the
 * local database, finds (or makes) the evaluation identity there, and opens a session on the bench's server.
 * Unlike the other Len-Bench runners it does NOT top the balance up: here the balance is the cap's lock.
 */
export async function startBench(base: string): Promise<BenchSession> {
  apagarEnEsteProceso(process.cwd());
  // The one call the bench makes itself (the summary) goes to the provider everything is counted at, with
  // no fallback — as the server's turns do (./arms.ts).
  process.env.OPENLEN_AGENT_PROVIDERS = "deepinfra";
  await exigirBaseLocal();
  const identity = identidadDeEval(process.env.EVAL_USER_EMAIL);
  if (!identity.ok) throw new Error(identity.motivo);
  let [owner] = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(eq(schema.users.email, identity.email)).limit(1);
  if (!owner) {
    // A throwaway database starts empty: the evaluation identity is made there (never anywhere else — the
    // database was just proven local).
    [owner] = await db.insert(schema.users).values({ id: crypto.randomUUID(), email: identity.email, name: "Len-Bench" }).returning({ id: schema.users.id, email: schema.users.email });
  }
  if (!owner) throw new Error("the evaluation identity could not be created");
  const ownerId = owner.id;
  const cookie = await acunarCookie({ userId: ownerId, email: owner.email, entorno: process.env });
  await comprobarSesion(base, cookie, ownerId);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const sql = poolSql(pool);
  return {
    owner,
    cookie,
    sql,
    open: (usd) => openBalance(sql, ownerId, usd),
    async close() {
      await lowerBalance(sql, ownerId, 0).catch(() => {});
      await pool.end();
    },
  };
}

export interface WorldOptions {
  readonly base: string;
  readonly session: Pick<BenchSession, "owner" | "cookie" | "sql">;
  /** The bench's folder (`BENCH_DIR`). */
  readonly dir: string;
  /** A question's turn is asked to stop after this long, like the panel's ■. */
  readonly timeoutTurnMs: number;
  /** A building turn's (the first turn of an app can take longer). */
  readonly timeoutBuildMs: number;
  readonly log: (line: string) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface StepRow {
  readonly step: number;
  readonly provider: string;
  readonly inputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly outputTokens: number | null;
}

export function createWorld(o: WorldOptions): World {
  const { sql, owner, cookie } = o.session;
  const webFile = (projectId: string) => ficheroDeLaWeb(path.join(process.cwd(), DIR_WEB), projectId);
  const captureFile = (t: Target) => idleSummaryCaptureFile(capturesDir(o.dir), `${t.projectId}:${t.conversation ?? ""}`);
  const rowsOf = (t: Target) => turnosParaElHistorial(t.projectId, ...(t.conversation ? [t.conversation] : []));
  const stepsAfter = (t: Target, mark: string) =>
    sql.query<StepRow>(
      `select "step", "provider", "inputTokens", "cachedTokens", "outputTokens" from "agentRequestSteps" where "projectId" = $1 and "createdAt" > $2::timestamp order by "createdAt", "step"`,
      [t.projectId, mark],
    );
  /** The conversation's newest row: its id, and how its turn ended. */
  const lastRow = async (t: Target) =>
    (
      await sql.query<{ id: string; endReason: string | null }>(
        `select "id", "endReason" from "projectChatMessages" where "projectId" = $1 and "conversation" is not distinct from $2 order by "createdAt" desc limit 1`,
        [t.projectId, t.conversation],
      )
    )[0] ?? null;
  const readJob = (file: string): IdleSummaryJobInput | null => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as IdleSummaryJobInput;
    } catch {
      return null;
    }
  };

  return {
    async createProject(c) {
      const projectId = await createThrowawayProject(owner.id, c.id, c.start, { title: c.title, brief: c.brief });
      if (c.web) {
        fs.mkdirSync(path.dirname(webFile(projectId)), { recursive: true });
        fs.writeFileSync(webFile(projectId), JSON.stringify(webASerializable(c.web)));
      }
      if (!c.assistant) return { projectId, assistantId: null, conversation: null };
      const made = await createAssistant({ personId: owner.id, projectId, input: { name: c.assistant.name, look: DEFAULT_LOOK, tone: "friendly" } });
      if (!made.ok) {
        await deleteThrowawayProject(projectId);
        throw new Error(`${c.id}: the assistant «${c.assistant.name}» could not be created (${made.code}) — an earlier build of this case may still be there`);
      }
      return { projectId, assistantId: made.assistant.id, conversation: assistantConversationKey(made.assistant.id) };
    },

    allow: (usd) => lowerBalance(sql, owner.id, usd),

    async ask(target, prompt, opts) {
      let answer = "";
      let error: { code: string; message: string } | null = null;
      try {
        const events = await enviarTurno({
          base: o.base,
          cookie,
          cuerpo: { projectId: target.projectId, prompt, turnId: crypto.randomUUID(), history: [], esfuerzo: "auto", zonaHoraria: ZONE, ...(target.assistantId ? { assistantId: target.assistantId } : {}) },
          timeoutMs: opts?.slow ? o.timeoutBuildMs : o.timeoutTurnMs,
        });
        answer = textoDeLen(events);
        const sent = events.find((e) => e.nombre === "error")?.datos as { code?: unknown; message?: unknown } | undefined;
        if (sent) error = { code: String(sent.code ?? "error"), message: String(sent.message ?? "") };
      } catch (err) {
        // The request itself failed — the route refused it, the connection dropped, or the turn was asked to
        // stop at its time limit. Not an answer: the runner counts whatever calls it made and goes on.
        const aborted = err instanceof Error && err.name === "AbortError";
        error = { code: aborted ? "timeout" : "transport", message: err instanceof Error ? err.message.slice(0, 300) : String(err) };
      }
      // A turn the balance cut short closes politely, with no error event: its row says how it ended.
      if (!error && (await lastRow(target))?.endReason === "budget_limit") error = { code: "budget_limit", message: "the turn was cut by the balance" };
      return { answer, error };
    },

    async files(target) {
      const [project] = await sql.query<{ html: string | null }>(`select "data"->>'html' as "html" from "projects" where "id" = $1`, [target.projectId]);
      const rows = await sql.query<{ path: string; content: string }>(`select "path", "content" from "projectFiles" where "projectId" = $1`, [target.projectId]);
      return { ...Object.fromEntries(rows.map((r) => [r.path, r.content])), ...(project?.html ? { "/index.html": project.html } : {}) };
    },

    async jobProblem(target) {
      const file = captureFile(target);
      if (!fs.existsSync(file)) return `the idle summary's job was not written to a file (${file})`;
      const job = readJob(file);
      if (!job || job.projectId !== target.projectId) return "the job on file is not this project's";
      const last = await lastRow(target);
      if (!last || job.rowId !== last.id) return "the job on file is of an earlier turn, not of the conversation's last one";
      return null;
    },

    async keepJob(caseId, target) {
      const kept = jobFile(o.dir, caseId);
      fs.mkdirSync(path.dirname(kept), { recursive: true });
      fs.copyFileSync(captureFile(target), kept);
    },

    async conversationTokens(target) {
      return Math.round(estimateTokens(historialDesdeLaBase(await rowsOf(target), undefined, undefined, WHOLE_HISTORY) ?? []));
    },

    async trimEffect(target) {
      // What a cold turn would send, against the conversation whole: no model, no turn.
      const rows = await rowsOf(target);
      const whole = historialDesdeLaBase(rows, undefined, undefined, WHOLE_HISTORY) ?? [];
      const trimmed = historialDesdeLaBase(rows, undefined, undefined, COLD_TRIM_MARK) ?? [];
      let resultsCleared = 0;
      whole.forEach((message, i) => {
        const after = trimmed[i]?.functionResponses ?? [];
        (message.functionResponses ?? []).forEach((response, j) => {
          if (JSON.stringify(response) !== JSON.stringify(after[j])) resultsCleared += 1;
        });
      });
      return { tokensBefore: Math.round(estimateTokens(whole)), tokensAfter: Math.round(estimateTokens(trimmed)), resultsCleared };
    },

    async save(caseId, target) {
      const kept = await saveSnapshot(sql, caseId, target.projectId);
      o.log(`${caseId}: kept (${kept.rows} rows in ${kept.tables} tables)`);
    },
    restore: (caseId, target) => restoreSnapshot(sql, caseId, target.projectId),
    async age(target) {
      await ageConversation(sql, target.projectId, PAUSE_MS);
    },

    async rowIds(target) {
      return (await sql.query<{ id: string }>(`select "id" from "projectChatMessages" where "projectId" = $1`, [target.projectId])).map((r) => r.id);
    },

    async mark(target) {
      const [row] = await sql.query<{ at: string }>(`select coalesce(max("createdAt"), 'epoch'::timestamp)::text as "at" from "agentRequestSteps" where "projectId" = $1`, [target.projectId]);
      return row?.at ?? "epoch";
    },

    async callsSince(target, mark) {
      // The route records its calls without waiting for them: read until two reads agree, or give up.
      let last = -1;
      let rows: StepRow[] = [];
      for (let i = 0; i < 12; i++) {
        rows = await stepsAfter(target, String(mark));
        if (rows.length > 0 && rows.length === last) break;
        if (rows.length === 0 && i >= 4) break;
        last = rows.length;
        await sleep(1_000);
      }
      return rows.map((r) => ({ step: r.step, provider: r.provider, reported: r.inputTokens !== null, inputTokens: r.inputTokens ?? 0, cachedTokens: r.cachedTokens ?? 0, outputTokens: r.outputTokens ?? 0 }));
    },

    async mechanism(target, before) {
      const rows = await sql.query<{ id: string; trimmed: boolean; idle: boolean }>(
        `select "id", ("transcript"->'coldTrim') is not null as "trimmed", coalesce("compaction"->>'trigger', '') = 'idle' as "idle"
           from "projectChatMessages" where "projectId" = $1 order by "createdAt"`,
        [target.projectId],
      );
      const known = new Set(before);
      const firstQuestion = rows.find((r) => !known.has(r.id));
      const sandbox = await sql.query<{ n: number }>(`select count(*)::int as "n" from "projectSandboxes" where "projectId" = $1`, [target.projectId]).catch(() => [{ n: 0 }]);
      return { firstQuestionTrimmed: firstQuestion?.trimmed === true, summaryPromoted: rows.some((r) => known.has(r.id) && r.idle), sandboxRows: sandbox[0]?.n ?? 0 };
    },

    async summarize(built, run) {
      // The bench's own copy, kept when the case was built: the server's file is overwritten by later turns.
      const file = jobFile(o.dir, built.caseId);
      const input = fs.existsSync(file) ? readJob(file) : null;
      if (!input) return { outcome: `no job kept for this case (${file}): build it again`, usage: null };
      if (input.projectId !== built.projectId) return { outcome: "the job kept is another project's", usage: null };
      const job = idleSummaryJobFor({ ...input, minTokens: benchIdleMinTokens(built.tokens) });
      let usage: TokenUsage | null = null;
      // The same function the idle timer calls; only the charge is listened to, for the bench's own count.
      const outcome = await runIdleSummary(
        {
          ...job,
          charge: async (u) => {
            usage = u;
            await job.charge(u);
          },
        },
        AbortSignal.timeout(o.timeoutTurnMs),
      );
      if (outcome === "saved") {
        const [row] = await sql.query<{ pending: unknown }>(`select "transcript"->'idleSummary' as "pending" from "projectChatMessages" where "id" = $1`, [input.rowId]);
        const kept = path.join(o.dir, "summaries", `${built.caseId}-r${run}.json`);
        fs.mkdirSync(path.dirname(kept), { recursive: true });
        fs.writeFileSync(kept, JSON.stringify(row?.pending ?? null, null, 2));
      }
      return { outcome, usage };
    },

    async discard(target) {
      await deleteThrowawayProject(target.projectId);
      fs.rmSync(webFile(target.projectId), { force: true });
      fs.rmSync(captureFile(target), { force: true });
    },
  };
}
