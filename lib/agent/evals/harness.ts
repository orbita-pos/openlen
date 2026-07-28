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
import { runAgentLoop, type AgentLoopArgs, type AgentStreamEvent } from "@/lib/agent/loop";
import { verifyEditedPage, type VisualVerdict } from "@/lib/agent/verify";
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
  /** P3 — eje visual: enciende los ojos del agente (verifyTurn, paridad con
   *  producción) y emite un veredicto visual del estado FINAL de los casos
   *  que mutaron el documento. Cuesta 1 llamada de visión por caso mutante
   *  (2 si el ciclo de auto-arreglo se disparó). */
  visual?: boolean;
}

/** P3 — el veredicto visual de un caso que mutó el documento. */
export interface EvalVisualResult {
  /** El estado FINAL quedó con rotura visual objetiva. */
  broken: boolean;
  issues: string[];
  /** El ciclo de auto-arreglo in-loop se disparó (los ojos vieron rotura). */
  selfFixAttempted: boolean;
  /** Se disparó Y el estado final quedó limpio — los ojos hicieron su trabajo. */
  fixedBySelf: boolean;
  /** Algún veredicto cayó en fallback (render/API/timeout) — sin juicio real. */
  fallback: boolean;
  /** Tokens de visión gastados por este caso (se suman al costo real). */
  visionInputTokens: number;
  visionOutputTokens: number;
}

export interface EvalRunResult {
  id: string;
  pass: boolean;
  reason: string | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  seconds: number;
  /** Presente solo en modo visual Y cuando el caso mutó el documento. */
  visual?: EvalVisualResult;
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

function errMessage(err: unknown): string {
  return err instanceof GatewayError
    ? err.message
    : String((err as { message?: unknown })?.message ?? err);
}

/** 429/TPM — la ventana de tokens-por-minuto se resetea por MINUTO, así que
 *  el backoff exponencial corto de isRetryable es inútil aquí (2026-07-14:
 *  chain-menu-y-reservas "falló" 3 veces seguidas por esto — cayó justo
 *  después de los casos más pesados de la batería — y costó 3 re-runs
 *  pagados adjudicarlo). Se espera la ventana completa. */
function isRateLimited(err: unknown): boolean {
  return /rate.?limit|(?:^|\D)429(?:\D|$)|resource.?exhausted|quota/i.test(errMessage(err));
}

/** Saldo prepagado AGOTADO — también llega como 429, pero re-intentarlo es
 *  quemar tiempo: la única cura es recargar en ai.studio (memoria
 *  gemini-key-prepaid-depletes). Fail-fast con mensaje accionable. */
function isDepleted(err: unknown): boolean {
  return /prepay|depleted|billing|saldo/i.test(errMessage(err));
}

const RATE_LIMIT_BACKOFF_MS = 65_000;

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
  verifyTurn?: AgentLoopArgs["verifyTurn"],
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
        photoSearchesThisTurn: 0,
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
        // P3 visual: los ojos encendidos, paridad con producción — el
        // auto-arreglo in-loop cuenta como parte del comportamiento medido.
        ...(verifyTurn ? { verifyTurn } : {}),
        emit: (ev) => events.push(ev),
      });

      // A 503 that surfaced as a terminal upstream error event (not a throw)
      // is also worth a bounded retry — and a rate-limit event needs the LONG
      // backoff (misma razón que isRateLimited abajo: la ventana es por
      // minuto; el exponencial corto re-toca la misma ventana agotada).
      const upstream = events.find((e) => e.type === "error" && e.code === "upstream");
      if (upstream && attempt < RETRY_ATTEMPTS) {
        const msg = (upstream as { message?: string }).message ?? "";
        lastErr = new Error(`upstream error event: ${msg}`);
        await sleep(
          /rate.?limit|429|resource.?exhausted|quota/i.test(msg)
            ? RATE_LIMIT_BACKOFF_MS + Math.random() * 1000
            : RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 500,
        );
        continue;
      }
      return { events, result };
    } catch (err) {
      lastErr = err;
      if (isDepleted(err)) {
        throw new Error(
          `SALDO GEMINI AGOTADO — recarga en https://ai.studio/projects; re-intentar no sirve. (${errMessage(err).slice(0, 120)})`,
        );
      }
      if (attempt < RETRY_ATTEMPTS && isRateLimited(err)) {
        await sleep(RATE_LIMIT_BACKOFF_MS + Math.random() * 1000);
        continue;
      }
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

  // P3 — eje visual: el recorder captura el veredicto in-loop (los ojos) y su
  // gasto; tras el loop, el estado FINAL se juzga (reusando el veredicto
  // in-loop cuando ya juzgó exactamente ese estado).
  const visionModel = process.env.OPENLEN_AGENT_VISION_MODEL?.trim() || "gemini-2.5-flash";
  let inLoopVerdict: VisualVerdict | null = null;
  let visionIn = 0;
  let visionOut = 0;
  const judge = async (html: string): Promise<VisualVerdict> => {
    const v = await verifyEditedPage({
      html,
      userPrompt: evalCase.prompt,
      model: visionModel,
      apiKey: opts.apiKey,
    });
    visionIn += v.usage?.inputTokens ?? 0;
    visionOut += v.usage?.outputTokens ?? 0;
    return v;
  };
  const verifyTurn: AgentLoopArgs["verifyTurn"] | undefined = opts.visual
    ? async ({ html }) => {
        const v = await judge(html);
        inLoopVerdict = v;
        return v.broken
          ? { ok: false, critique: v.issues.map((i) => `- ${i}`).join("\n") }
          : { ok: true };
      }
    : undefined;

  try {
    const { events, result } = await runLoopWithRetry(provider, model, opts, projectId, evalCase.prompt, verifyTurn);

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

    // P3 — veredicto visual del estado final, solo para casos que mutaron.
    let visual: EvalVisualResult | undefined;
    if (opts.visual) {
      const htmlEvents = events.filter(
        (e): e is Extract<AgentStreamEvent, { type: "html" }> => e.type === "html",
      );
      if (htmlEvents.length > 0) {
        const lastHtml = htmlEvents[htmlEvents.length - 1].html;
        // Cast: TS no ve la asignación dentro del closure verifyTurn y
        // estrecha inLoopVerdict a null (never al leer campos).
        const first = inLoopVerdict as VisualVerdict | null;
        // Si los ojos in-loop juzgaron LIMPIO, juzgaron exactamente el estado
        // final (verifican al cierre) — reusar, no pagar otra llamada. Si
        // vieron rotura (hubo ciclo de arreglo) o nunca corrieron (presupuesto
        // agotado), el estado final aún no tiene juicio: una llamada más.
        const final =
          first && !first.broken && !first.fallback ? first : await judge(lastHtml);
        const selfFixAttempted = first?.broken === true;
        visual = {
          broken: final.broken,
          issues: final.issues,
          selfFixAttempted,
          fixedBySelf: selfFixAttempted && !final.broken,
          fallback: final.fallback || (first?.fallback ?? false),
          visionInputTokens: visionIn,
          visionOutputTokens: visionOut,
        };
      }
    }

    return {
      id: evalCase.id,
      pass: reason === null,
      reason,
      inputTokens: result.usage.inputTokens,
      cachedTokens: result.usage.cachedTokens,
      outputTokens: result.usage.outputTokens,
      seconds: (Date.now() - started) / 1000,
      ...(visual ? { visual } : {}),
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
