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
import { listProfiles } from "@/lib/business-profiles/store";
import { GatewayError } from "@/lib/ai-gateway";
import { createAgentBrain } from "@/lib/agent/brain";
import { tagWithOpIds } from "@/lib/html-ops";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildAgentMessages } from "@/lib/agent/context";
import { identidadDeEval, preferenciaAterrizo } from "./eval-identity";
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
<!-- El fixture CONSUME los tokens que su <html> declara.
     Antes sólo los declaraba, que es una página que no existe: las nacidas de
     /api/generate llevan las dos mitades. Y desde que cambiar_tema comprueba
     si alguien LEE el token antes de reportar éxito (2026-08-22), un fixture
     que sólo declara haría fallar los seis casos de tema — sobre un cambio que
     en la realidad sí funciona. Un fixture irreal convierte la batería en ruido. -->
<style>
  body { background: var(--ol-bg, #fff); color: var(--ol-fg, #111); font-family: var(--ol-font-display, system-ui), sans-serif; }
  h1, h2 { font-family: var(--ol-font-display, system-ui), sans-serif; }
  [role="button"] { background: var(--ol-accent); color: var(--ol-accent-ink, #fff); border-radius: calc(8px * var(--ol-r-scale, 1)); padding: 12px 20px; display: inline-block; text-decoration: none; }
</style>
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
  /** Qué modelo llevó el turno. Lo reporta el cerebro, no una constante del
   *  runner: con el identificador equivocado el tope de gasto miente. */
  modelId: string;
  seconds: number;
  /** Presente solo en modo visual Y cuando el caso mutó el documento. */
  visual?: EvalVisualResult;
}

/** Resolve the eval owner strictly from EVAL_USER_EMAIL — no default, so a
 *  missing/unknown value fails loud rather than silently touching some other
 *  account's data. Returns { id, email }. */
export async function resolveEvalUser(): Promise<{ id: string; email: string }> {
  // La cuenta tiene que ser una IDENTIDAD DE EVALUACIÓN, no una cualquiera. Un
  // turno del Agente puede llamar a `recordar_preferencia`, y eso escribe en
  // `users.agentMemory` — la memoria que cruza todos los proyectos de esa
  // persona— mientras la limpieza de aquí abajo sólo borra el proyecto. Ver
  // ./eval-identity.ts para por qué la puerta es una etiqueta en el correo.
  const identidad = identidadDeEval(process.env.EVAL_USER_EMAIL);
  if (!identidad.ok) throw new Error(identidad.motivo);
  const email = identidad.email;
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

/** La memoria de usuario ANTES del caso, para poder devolverla.
 *
 * Defensa en profundidad, no la defensa principal: la puerta de
 * `identidadDeEval` ya impide que esto corra sobre una cuenta de verdad. Pero
 * una identidad dedicada tampoco debe ARRASTRAR lo que dijo el caso anterior —
 * el caso 7 leería como preferencia del usuario algo que escribió el caso 3, y
 * el marcador saldría verde o rojo por un motivo que no está en el fixture. */
export async function snapshotAgentMemory(userId: string): Promise<string | null> {
  const rows = await db
    .select({ m: schema.users.agentMemory })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.m ?? null;
}

/**
 * El PERFIL del negocio antes del caso, en crudo.
 *
 * Mismo motivo que `snapshotAgentMemory`: `guardar_dato_del_negocio` escribe en
 * una tabla que la limpieza de abajo no toca —borra el proyecto, no el negocio—
 * así que sin comparar contra el ANTES, un dato que dejó el caso anterior daría
 * por bueno un turno que no guardó nada.
 */
export async function snapshotPerfilNegocio(userId: string): Promise<string> {
  try {
    const perfiles = await listProfiles(userId);
    return JSON.stringify(perfiles.map((p) => p.data));
  } catch {
    return "";
  }
}

export async function restoreAgentMemory(userId: string, previo: string | null): Promise<void> {
  await db
    .update(schema.users)
    .set({ agentMemory: previo })
    .where(eq(schema.users.id, userId));
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
  opts: RunEvalOptions,
  projectId: string,
  prompt: string,
  verifyTurn?: AgentLoopArgs["verifyTurn"],
): Promise<{ events: AgentStreamEvent[]; result: Awaited<ReturnType<typeof runAgentLoop>>; modelId: string }> {
  const deps = realDeps();
  // El arnés evalúa siempre sobre la Home, y esa suposición se escribe UNA vez.
  // Antes vivía dos veces —aquí implícita y abajo explícita—, que es la forma
  // exacta del hallazgo 1: dos capas decidiendo lo mismo por su cuenta.
  const tools = buildFunctionDeclarations(process.env);
  let lastErr: unknown;
  let modelId = "";

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
        busquedasVaciasSeguidas: 0,
      };

      // El MISMO cerebro que la ruta. Aquí vivía una copia de su elección de
      // proveedor, y cuando el Agente pasó a DeepSeek la copia se quedó midiendo
      // Gemini sin que nada fallara: la batería habría certificado un modelo que
      // el producto ya no usa.
      const brain = createAgentBrain({ tools, requestId: projectId, signal: abort.signal });
      modelId = brain.modelId;
      const result = await runAgentLoop({
        messages: built.messages,
        tools,
        openStream: (msgs) => brain.openStream(msgs),
        closeOut: (msgs) => brain.closeOut(msgs),
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
      return { events, result, modelId };
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
  // Ya no hay `EVAL_AGENT_MODEL`: quién razona lo decide `lib/agent/brain`, el
  // mismo sitio del que tira la ruta, y un override sólo del harness volvería a
  // abrir la puerta a certificar un modelo que producción no corre. La salida de
  // emergencia sigue existiendo, pero es la MISMA que en producción:
  // `OPENLEN_AGENT_PROVIDER=gemini`.
  //
  // Sigue valiendo el hallazgo del 2026-07-28: gemini-2.5-flash NO sirve para el
  // loop — con el system prompt del agente (~14k tokens) mas las 16 tool
  // declarations devuelve turnos VACÍOS (end_turn, 0 output, 0 calls), aislado
  // determinísticamente en scratch/probe-25-matrix.mjs.
  let data: ProjectData = { html: FIXTURE_HTML };
  if (evalCase.setup) data = evalCase.setup(data);

  const projectId = await createThrowawayProject(opts.userId, evalCase.id, data);
  // FILAS QUE YA ESTABAN. Un caso de CORREGIR o QUITAR sólo mide algo si hay
  // algo que corregir: sin esto le pedíamos a Len cambiar el precio de un taco
  // que no existía, en un almacén que tampoco, y contábamos como fallo suyo que
  // no tocara nada — cuando no tocar nada era lo correcto. Va aquí y no en
  // `setup` porque las filas no viven en `ProjectData`: viven en `pageData`, su
  // propia tabla. La limpieza no necesita saber de ellas: el FK es ON DELETE
  // CASCADE, así que se van con el proyecto.
  if (evalCase.seedDatos) {
    for (const [store, filas] of Object.entries(evalCase.seedDatos)) {
      for (const doc of filas) {
        await db.insert(schema.pageData).values({
          projectId,
          store,
          doc,
          bytes: JSON.stringify(doc).length,
        });
      }
    }
  }
  // La memoria de usuario ANTES del caso. `recordar_preferencia` escribe en una
  // columna que la limpieza de abajo no toca —borra el proyecto, no la persona—,
  // así que sin esto cada caso hereda lo que dijo el anterior y el marcador se
  // mueve por algo que no está en el fixture.
  const memoriaPrevia = await snapshotAgentMemory(opts.userId);
  const negocioPrevio = await snapshotPerfilNegocio(opts.userId);
  const started = Date.now();

  // P3 — eje visual: el recorder captura el veredicto in-loop (los ojos) y su
  // gasto; tras el loop, el estado FINAL se juzga (reusando el veredicto
  // in-loop cuando ya juzgó exactamente ese estado).
  let inLoopVerdict: VisualVerdict | null = null;
  let visionIn = 0;
  let visionOut = 0;
  const judge = async (html: string): Promise<VisualVerdict> => {
    const v = await verifyEditedPage({
      html,
      userPrompt: evalCase.prompt,

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
    const { events, result, modelId } = await runLoopWithRetry(opts, projectId, evalCase.prompt, verifyTurn);

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
    // LA PREFERENCIA TIENE QUE HABER ATERRIZADO EN ALGUNA PARTE.
    //
    // Este invariante exigía `projects.userBrief` no vacío, y esa es la columna
    // EQUIVOCADA desde el 2026-08-22: `recordar_preferencia` guarda por defecto
    // con alcance «siempre», que escribe en `users.agentMemory` —la memoria de la
    // PERSONA— y sólo toca `userBrief` cuando el turno pide «esta_pagina».
    //
    // Los dos casos que cubren la herramienta dicen literalmente «siempre me
    // hables de tú» y «acuérdate SIEMPRE de tratarme de usted», así que el modelo
    // elegía bien, escribía en la memoria global, dejaba `userBrief` vacío y el
    // oráculo lo SUSPENDÍA por acertar. Un eval que castiga la conducta correcta
    // no mide: empuja en dirección contraria.
    //
    // Se compara la memoria CONTRA LA DE ANTES del caso, no contra vacío: la
    // identidad de evaluación puede traer algo escrito, y «no está vacía» habría
    // dado por bueno un turno que no guardó nada.
    if (
      reason === null &&
      coverage[evalCase.id]?.includes("recordar_preferencia") &&
      !result.terminalError
    ) {
      const memoriaAhora = await snapshotAgentMemory(opts.userId);
      if (
        !preferenciaAterrizo({
          memoriaPrevia,
          memoriaAhora,
          userBrief: finalRow?.userBrief,
        })
      ) {
        reason =
          "la preferencia no quedó guardada en ningún sitio: users.agentMemory igual que antes del caso y projects.userBrief vacío";
      }
    }

    // Y EL DATO DEL NEGOCIO TIENE QUE HABER ATERRIZADO.
    //
    // Mismo invariante que la preferencia, y por el mismo motivo: la herramienta
    // puede sonar, devolver `ok` y dejar el perfil intacto —basta con resolver
    // uno distinto del que se lee— y entonces el eval estaría midiendo que el
    // modelo dijo la palabra, no que el dato se guardó. Que es justo el fallo
    // que esta herramienta viene a cerrar.
    if (
      reason === null &&
      (coverage[evalCase.id]?.includes("guardar_dato_del_negocio") ||
        coverage[evalCase.id]?.includes("recordar_del_negocio")) &&
      !result.terminalError
    ) {
      const negocioAhora = await snapshotPerfilNegocio(opts.userId);
      if (negocioAhora === negocioPrevio) {
        reason =
          "no quedó nada en el perfil del negocio: business_profiles igual que antes del caso";
      }
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
      modelId,
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
      modelId: "",
      seconds: (Date.now() - started) / 1000,
    };
  } finally {
    // La memoria vuelve a como estaba SIEMPRE, pase lo que pase con el caso. Un
    // fallo aquí se grita pero nunca se lanza: taparía el veredicto.
    await restoreAgentMemory(opts.userId, memoriaPrevia).catch((err: unknown) => {
      console.error(
        `[eval] NO SE PUDO DEVOLVER users.agentMemory de ${opts.userId} (${evalCase.id}) —`,
        `la cuenta se queda con lo que escribió el caso:`,
        err,
      );
    });
    await deleteThrowawayProject(projectId).catch((err: unknown) => {
      // Surface loudly — a leaked throwaway row in prod Neon is a real problem —
      // but never throw out of finally (would mask the verdict).
      console.error(`[eval] CLEANUP FAILED for project ${projectId} (${evalCase.id}):`, err);
    });
  }
}
