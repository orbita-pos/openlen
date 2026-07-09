// lib/agent/evals/harness.ts — runs one eval case end-to-end against the REAL
// model + tool runtime, then cleans up (F3 Task 6).
//
// Flow per case: insert a throwaway project row (fixture HTML) owned by the
// EVAL_USER_EMAIL user → assemble the turn with the SAME buildAgentMessages the
// route uses → runAgentLoop with a real GeminiProvider + runAgentTool/realDeps
// → collect stream events → re-read the row → run the case's assert → DELETE the
// row in `finally`. A bounded 503-retry absorbs the Gemini 3.5-flash upstream
// spikes seen earlier today.
//
// SAFETY: dev DB === prod Neon. We ONLY ever touch rows we just inserted, and
// the delete cascades (every FK to projects is ON DELETE CASCADE — same reliance
// as lib/projects.ts deleteProject). Existing projects are never read or written.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { GatewayError, GeminiProvider } from "@/lib/ai-gateway";
import { resolveAIProvider } from "@/lib/ai-provider";
import { tagWithOpIds } from "@/lib/html-ops";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildAgentMessages } from "@/lib/agent/context";
import { runAgentLoop, type AgentStreamEvent } from "@/lib/agent/loop";
import {
  realDeps,
  runAgentTool,
  summarizeProjectState,
  type AgentSession,
} from "@/lib/agent/tools";
import type { ProjectData } from "@/lib/projects/types";
import { coverage, type EvalCase } from "./cases";

// A tag-rich, valid fixture: hero h1 + subtitle + CTA button + a REAL
// images.openlen.com photo in the hero (so the costly editar_imagen case passes
// the on-page-URL guard) + an --ol-accent seed on <html> (so cambiar_tema's
// modo/accent paths have something to derive from).
const FIXTURE_IMAGE = "https://images.openlen.com/01-warm-glassy-800.webp";
const FIXTURE_HTML = `<!doctype html>
<html lang="es" style="--ol-accent: #e11d48; --ol-accent-r: 225,29,72">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mi Negocio</title>
</head>
<body>
<header>
<nav><a href="#inicio">Inicio</a> <a href="#contacto">Contacto</a></nav>
</header>
<main>
<section id="inicio">
<h1>Bienvenido a Mi Negocio</h1>
<p>El mejor lugar de la ciudad, atendido por su propia dueña desde el primer día.</p>
<img src="${FIXTURE_IMAGE}" alt="Formas de vidrio esmerilado en tonos durazno" width="800" height="600">
<a href="#contacto" role="button">Contáctanos</a>
</section>
<section id="servicios">
<h2>Nuestros servicios</h2>
<p>Ofrecemos calidad, cercanía y trato humano.</p>
</section>
<footer><p>© 2026 Mi Negocio</p></footer>
</main>
</body>
</html>`;

const MAX_PROMPT_TOKENS = 240_000;
const PER_CASE_TIMEOUT_MS = 180_000;
// Gemini 3.5-flash saw sustained 503 "high demand" spikes during F3; a handful
// of bounded retries with exponential backoff + jitter rides them out (a single
// spike lasts seconds, not minutes).
const RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 1500;

export interface RunEvalOptions {
  userId: string;
  ownerEmail: string;
  apiKey: string;
}

export interface EvalRunResult {
  id: string;
  pass: boolean;
  reason: string | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  seconds: number;
}

/** Resolve the eval owner strictly from EVAL_USER_EMAIL — no default, so a
 *  missing/unknown value fails loud rather than silently touching some other
 *  account's data. Returns { id, email }. */
export async function resolveEvalUser(): Promise<{ id: string; email: string }> {
  const email = process.env.EVAL_USER_EMAIL?.trim();
  if (!email) {
    throw new Error(
      "EVAL_USER_EMAIL is not set — the eval harness refuses to run without an explicit owner email (no default).",
    );
  }
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (!rows[0]) {
    throw new Error(`EVAL_USER_EMAIL="${email}" matches no users row — create the account or fix the env var.`);
  }
  return rows[0];
}

/** Insert a throwaway project row and return its id. Title is
 *  "Agent Eval <caseId>" so a leaked row (crash before cleanup) is obvious in
 *  the DB and greppable for a manual sweep. */
export async function createThrowawayProject(
  userId: string,
  caseId: string,
  data: ProjectData,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.projects).values({
    id,
    userId,
    title: `Agent Eval ${caseId}`,
    brief: "Agent eval throwaway fixture — safe to delete.",
    data,
  });
  return id;
}

async function deleteThrowawayProject(projectId: string): Promise<void> {
  // ON DELETE CASCADE on every projects FK wipes dependents (projectVersions,
  // chatUsers, etc.) — same one-row delete lib/projects.ts deleteProject relies
  // on. Best-effort: a cleanup failure must surface but never mask the result.
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof GatewayError) {
    return err.retryable || /50[0234]|unavailable|overloaded|deadline|timeout/i.test(err.message);
  }
  return /50[0234]|unavailable|overloaded|deadline|timeout|econnreset|etimedout|fetch failed|socket hang up/i.test(
    String((err as { message?: unknown })?.message ?? err),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run the agentic loop once, rebuilding the turn from the CURRENT row each
 *  attempt (a 503 almost always hits at stream-open, before any mutation, so a
 *  rebuild-from-fresh retry is safe). Retries bounded + exponential backoff. */
async function runLoopWithRetry(
  provider: GeminiProvider,
  model: string,
  opts: RunEvalOptions,
  projectId: string,
  prompt: string,
): Promise<{ events: AgentStreamEvent[]; result: Awaited<ReturnType<typeof runAgentLoop>> }> {
  const deps = realDeps();
  const tools = buildFunctionDeclarations();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PER_CASE_TIMEOUT_MS);
    const events: AgentStreamEvent[] = [];
    try {
      const row = await deps.loadProject(projectId, opts.userId);
      if (!row) throw new Error("fixture row vanished mid-run");
      const state = summarizeProjectState(row);
      const { taggedHtml } = tagWithOpIds(row.data.html);
      const built = buildAgentMessages({
        state,
        taggedHtml,
        userBrief: row.userBrief,
        prompt,
        history: [],
        maxPromptTokens: MAX_PROMPT_TOKENS,
      });
      if (!built.ok) throw new Error("fixture too large for a turn (unexpected)");

      const session: AgentSession = {
        projectId,
        userId: opts.userId,
        taggedHtml,
        // The turn always STARTS on the home document (mirrors a canvas that
        // hasn't been pointed at a subpage yet) — a case that needs a
        // subpage (F4 Task 5's mp-* cases, whose `setup` adds one via
        // createSitePage) relies on the model calling trabajar_en_pagina
        // itself mid-turn, exactly like a real user asking to edit "la
        // página de menú" while looking at Home. That's the in-vivo
        // exercise of the tool, not a harness shortcut.
        page: null,
        ownerEmail: opts.ownerEmail,
        imageEditsThisTurn: 0,
      };

      const result = await runAgentLoop({
        messages: built.messages,
        tools,
        openStream: (msgs) =>
          provider.stream(
            { model, messages: msgs, tools, toolMode: "auto", maxOutputTokens: 16_384, temperature: 0.7 },
            { signal: abort.signal },
          ),
        runTool: (name, args) => runAgentTool(session, deps, name, args),
        emit: (ev) => events.push(ev),
      });

      // A 503 that surfaced as a terminal upstream error event (not a throw)
      // is also worth a bounded retry.
      const upstream = events.find((e) => e.type === "error" && e.code === "upstream");
      if (upstream && attempt < RETRY_ATTEMPTS) {
        lastErr = new Error(`upstream error event: ${(upstream as { message?: string }).message ?? ""}`);
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 500);
        continue;
      }
      return { events, result };
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_ATTEMPTS && isRetryable(err)) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 500);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("loop failed after retries");
}

/** Run one eval case end-to-end and return its verdict. Always cleans up the
 *  throwaway row (finally), even on assert failure or a thrown loop error. */
export async function runEvalCase(evalCase: EvalCase, opts: RunEvalOptions): Promise<EvalRunResult> {
  const provider = new GeminiProvider(opts.apiKey);
  const model = resolveAIProvider("gemini-flash").model;

  let data: ProjectData = { html: FIXTURE_HTML };
  if (evalCase.setup) data = evalCase.setup(data);

  const projectId = await createThrowawayProject(opts.userId, evalCase.id, data);
  const started = Date.now();

  try {
    const { events, result } = await runLoopWithRetry(provider, model, opts, projectId, evalCase.prompt);

    // Re-read the FULL row: the case assert only sees ProjectData, so the
    // publishedAt + userBrief COLUMN invariants are enforced here.
    const rows = await db
      .select({
        data: schema.projects.data,
        userBrief: schema.projects.userBrief,
        publishedAt: schema.projects.publishedAt,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    const finalRow = rows[0];
    const finalData: ProjectData = finalRow?.data ?? data;

    let reason = evalCase.assert({ data: finalData, events, result });

    // Global publish-safety invariant: nothing may ever publish in-loop.
    if (reason === null && finalRow?.publishedAt != null) {
      reason = "publishedAt no quedó en null — algo publicó dentro del loop";
    }
    // Memory invariant: a case that covers recordar_preferencia must leave a
    // non-empty userBrief when the turn completed cleanly.
    if (
      reason === null &&
      coverage[evalCase.id]?.includes("recordar_preferencia") &&
      !result.terminalError &&
      !(finalRow?.userBrief?.trim())
    ) {
      reason = "userBrief quedó vacío tras cubrir recordar_preferencia";
    }

    return {
      id: evalCase.id,
      pass: reason === null,
      reason,
      inputTokens: result.usage.inputTokens,
      cachedTokens: result.usage.cachedTokens,
      outputTokens: result.usage.outputTokens,
      seconds: (Date.now() - started) / 1000,
    };
  } catch (err) {
    return {
      id: evalCase.id,
      pass: false,
      reason: `excepción: ${String((err as { message?: unknown })?.message ?? err).slice(0, 160)}`,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      seconds: (Date.now() - started) / 1000,
    };
  } finally {
    await deleteThrowawayProject(projectId).catch((err: unknown) => {
      // Surface loudly — a leaked throwaway row in prod Neon is a real problem —
      // but never throw out of finally (would mask the verdict).
      console.error(`[eval] CLEANUP FAILED for project ${projectId} (${evalCase.id}):`, err);
    });
  }
}
