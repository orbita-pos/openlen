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
import { GatewayError } from "@/lib/ai-gateway";
import { createAgentBrain } from "@/lib/agent/brain";
import { tagWithOpIds } from "@/lib/html-ops";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { PROMPT_MINIMO, herramientasDelSobre, type Sobre } from "@/lib/agent/evals/sobres";
import { buildAgentMessages } from "@/lib/agent/context";
import { identidadDeEval, preferenciaAterrizo } from "./eval-identity";
import { runAgentLoop, type AgentLoopArgs, type AgentStreamEvent } from "@/lib/agent/loop";
import { verifyEditedPage, type VisualVerdict } from "@/lib/agent/verify";
import { componerMedicion, type MedicionCruda } from "@/lib/agent/aviso-medido";
import { evaluarCondicion } from "@/lib/agent/objetivo/evaluar-condicion";
import { medirUnaVezPorDocumento } from "@/lib/ai/medir-una-vez";
import { inlineOwnAssets } from "@/lib/projects/inline-own-assets";
import { vistaParaMedir } from "@/lib/lienzo/documento";
import {
  createVisualQualityRendererPool,
  renderVisualQualityViewports,
  type VisualQualityRendererPool,
} from "@/lib/ai/visual-quality-renderer";
import {
  realDeps,
  runAgentTool,
  summarizeProjectState,
  type AgentSession,
} from "@/lib/agent/tools";
import { formaDePrueba, type PasoSpec, type FalloSpec } from "@/lib/agent/behavior-spec";
import type { VerifyOutcome } from "@/lib/agent/loop";
import {
  actualizarSuite,
  marcarRegresiones,
  pasosAJs,
  vivas,
  type PruebaGuardada,
} from "@/lib/agent/pruebas-de-la-pagina";
import type { ProjectData } from "@/lib/projects/types";
import { coverage, prometioYSeComprobo, type EvalCase, type EvalCumplimiento, type PruebaEnEval } from "./cases";
import { anotarPromesas, cumplimientoDelTurno, type PromesasDelArnes } from "./promesas";

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
  /* 🔴 EL FIXTURE NACIA DESBORDADO EN MOVIL, y se descubrio en la primera
     corrida de EvalHechos (2026-09-21): 5 de 8 casos salieron con «rotura
     objetiva» y los CINCO eran el mismo hecho — el img llegando a 808px en un
     viewport de 390. No lo hacia el modelo: lo traia puesto el <img
     width="800"> de aqui abajo, sin una sola regla que lo hiciera encoger.

     Si ese medidor hubiera nacido puntuando, habría suspendido a cinco casos
     SANOS por un defecto NUESTRO, y la culpa se le habría atribuido al modelo.
     Es la tercera vez que pasa (calc, prueba) y la primera que la figura
     scored:false lo para antes.

     La regla es además la REAL: una página nacida de /api/generate la lleva.
     Un fixture que desborda de fábrica no representa nada y mete ruido en todo
     lo que se mida encima — la misma razón que ya obligó a que el fixture
     CONSUMA los tokens que declara, dos comentarios más arriba. */
  img { max-width: 100%; height: auto; }
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
  /** EL SOBRE con el que corre el turno. Ausente = `"openlen"`, o sea lo que
   *  manda producción: la batería de siempre sale byte a byte igual.
   *
   *  `"minimo"` es el brazo de control del experimento de los dos sobres
   *  (`lib/agent/evals/sobres.ts`): el MISMO modelo, el MISMO protocolo de ops
   *  y la MISMA página, con un prompt de terminal y cuatro herramientas. Existe
   *  para poder atribuir un fallo al sobre en vez de suponerlo. */
  sobre?: Sobre;
  /**
   * LO MEDIDO DE VUELTA AL MODELO — paridad con la ruta (`medirParaElModelo` +
   * `lineaBase` en `app/api/agent/route.ts`).
   *
   * ⚰️ El arnés no las enchufaba, y esa deriva se descubrió el 2026-09-06
   * intentando medir «¿el modelo arregla el defecto cuando se lo devuelves?»:
   * la respuesta no se podía obtener porque en la batería el aviso NO LLEGA AL
   * MODELO. La cabecera de este fichero promete «lo mismo que hace la ruta» y
   * llevaba dos dependencias de menos.
   *
   * Apagado por omisión, igual que `visual` y por el mismo motivo: encenderlo
   * mete mensajes nuevos en el turno, así que la batería histórica dejaría de
   * ser comparable consigo misma. Encendido, cuesta un render por tanda que
   * edita — segundos, cero créditos.
   */
  aviso?: boolean;
  /**
   * BRAZO DE CONTROL: apaga la línea base dejando la medición encendida.
   *
   * No es una palanca de producto —la ruta siempre pasa la base— sino el único
   * modo de que un defecto PREEXISTENTE llegue al modelo, que es lo que hace
   * medible «¿actúa sobre la dirección?» con una página rota de fixture. El
   * sobre que recibe es byte a byte el que produciría un defecto nuevo.
   *
   * Mismo papel que `sobre: "minimo"`: un brazo, no una alternativa.
   */
  sinLineaBase?: boolean;
}

/**
 * LOS HECHOS MECÁNICOS DEL ESTADO FINAL — CORRE, SE REPORTA, **NO PUNTÚA**.
 *
 * 🔴 `scored: false` NO ES UNA DUDA, ES LA FIGURA. Claude Code la trae de serie
 * en su propio arnés: un chequeo que se ejecuta y se enseña sin entrar en el
 * score. Es **la forma
 * correcta de estrenar un medidor sin corpus**, y es exactamente lo que les
 * faltó a `calc` y a `prueba` — los dos se estrenaron votando, y `prueba`
 * acabó acusando a 3 páginas sanas de 3.
 *
 * ⚠️ POR QUÉ NO SE PROMUEVE HOY, aunque sea tentador: promoverlo cambiaría el
 * `pass` de los 64 casos a la vez, o sea el significado del marcador histórico,
 * y sin una corrida que diga cuántos casos sanos se pondrían rojos. Esta casa
 * ya degradó este canal una vez tras medirlo: **se promueve con datos, no con
 * ganas**. Una corrida y el número está.
 *
 * ⚠️ Y REPORTARLO NO ES OPCIONAL. Retirar el voto no puede significar apagar la
 * medición, o la corrida siguiente no tiene con qué desmentirte — es la regla
 * que dejó `el-comprobador-que-acierta-cero-de-tres`.
 *
 * NO lleva opinión de modelo: sale de un `verifyEditedPage({ sinVision: true })`,
 * donde el crítico no llega a correr y `broken` lo ponen sólo los cuatro hechos
 * de Chromium. Cero créditos; cuesta el render que ya se paga en segundos.
 */
export interface EvalHechos {
  /** Chromium midió algo objetivamente roto en el estado final. */
  readonly roto: boolean;
  /** Las frases de esos hechos, recortadas para el informe. */
  readonly issues: readonly string[];
  /** SIEMPRE `false`. Está en el tipo, y no sólo en un comentario, para que
   *  promoverlo sea un cambio DELIBERADO y no un descuido de alguien que
   *  añade `|| hechos.roto` a la línea del `pass`. */
  readonly scored: false;
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
  /** Subconjunto de `outputTokens`. Es lo que permite comprobar que un
   *  nivel de esfuerzo entrega el pensamiento que promete, en vez de
   *  deducirlo del total. */
  thinkingTokens: number;
  /** Qué modelo llevó el turno. Lo reporta el cerebro, no una constante del
   *  runner: con el identificador equivocado el tope de gasto miente. */
  modelId: string;
  seconds: number;
  /** Presente solo en modo visual Y cuando el caso mutó el documento. */
  visual?: EvalVisualResult;
  /** Los hechos mecánicos del estado final. CORRE, SE REPORTA, NO PUNTÚA —
   *  ver `EvalHechos`. Nunca entra en `pass`. */
  hechos?: EvalHechos;
  /** Lo que la promesa declarada hizo contra el estado final. Como `hechos`:
   *  corre, se reporta, NO puntúa. ⚠️ Se calculaba y se tiraba sin imprimir —
   *  el mismo defecto que esto viene a cerrar, cometido aquí mismo. */
  cumplimiento?: EvalCumplimiento;
  /** El programa que el modelo mandó por la ranura `prueba_js`, si la usó.
   *  Va al informe: sin esto la corrida no puede contestar si la ruta se usa. */
  pruebasJs?: string;
  /** UNA ENTRADA POR LLAMADA A UNA PUERTA QUE PODÍA LLEVAR PRUEBA, en orden.
   *
   *  🔴 Va al informe porque es EL INSTRUMENTO, y un instrumento que no se
   *  imprime no se puede auditar: el 2026-09-21 (noche) un caso salió PASS sin
   *  promesa viva y desde fuera no había forma de saber si es que el arnés no
   *  anotó nada o si el veredicto lo leyó y calló. Son dos bugs distintos y se
   *  estaban persiguiendo a ciegas. */
  declaradas?: readonly PruebaEnEval[];
  /** LO QUE DIRÍA `prometioYSeComprobo` DE ESTE CASO — corra o no en su
   *  `assert`. **Se mide en los 65, puntúa en 3.**
   *
   *  Es la figura de siempre en esta casa (`scored: false`): corre, se enseña,
   *  y no entra en el `pass`. Ausente ⇒ nada que decir (no editó, o cumplió).
   *  Presente ⇒ la frase, que es evidencia y no un booleano. */
  promesaMedida?: string;
  /** Lo que devolvió ESE programa al EJECUTARSE — el DETALLE de la ruta, para
   *  el informe. Lo que PUNTÚA es `cumplimiento`, que desde el 2026-09-21
   *  (noche) el arnés construye también para esta ruta (`forma: "js"`): las dos
   *  se juzgan con el mismo juez y no hay dos definiciones de «se cumplió».
   *
   *  🔴 Ausente ⇒ no se midió (no mandó JS, o el render reventó). Presente y
   *  vacío ⇒ corrió y la promesa se cumplió. Son estados distintos a propósito:
   *  el primero no acusa a nadie, el segundo dice que la página cumplió. */
  pruebaJsFallos?: readonly FalloSpec[];
  /** Con `aviso`, la SECUENCIA de mediciones del turno: una por tanda que tocó
   *  el documento, en orden. Es el instrumento que distingue «el modelo ignoró
   *  el aviso» de «el aviso nunca se emitió» — sin ella las dos se leen igual
   *  desde fuera. */
  medidas?: MedicionCruda[];
  /** Lo que el aviso le DIJO al modelo, literal y en orden — capturado de los
   *  mensajes que recibió, no recompuesto aquí. Es lo que distingue «acertó a la
   *  primera» de «lo arregló porque se lo dijimos»: sin esto las dos salen como
   *  un PASS idéntico. Ausente cuando el caso no pide `aviso` o nunca hubo nada
   *  que decir. */
  avisos?: string[];
  /**
   * La condicion que el modelo PROPUSO, si es que propuso.
   *
   * 🔴 EL PASS NO LO DICE. `propone-objetivo` acepta «propone O termina», asi
   * que un verde no distingue las dos, y son la pregunta entera: la unica
   * puerta al objetivo en este producto es que Len lo proponga —no hay `/goal`
   * ni nada equivalente— asi que «cuantas veces propone» ES la medida de si la
   * maquinaria puede alcanzarse. Sin este campo, repetir el caso cinco veces da
   * cinco PASS y cero informacion.
   */
  propuso?: string;
  /**
   * QUE HIZO, turno a turno: los nombres de las herramientas que llamo, en
   * orden, con el dato que las distingue.
   *
   * 🔴 EXISTE PORQUE UN FALLO REPETIDO NO SE EXPLICA CON UN VEREDICTO.
   * `telefono-en-las-cuatro` fallo 7 de 7 dejando SIEMPRE la misma pagina, y
   * para saber por que hay que ver si visito `/servicios` y no edito, o si ni
   * llego a visitarla. Sin esto la unica via era pagar una corrida por hipotesis
   * — y ya se pagaron tres.
   */
  llamadas?: string[];
  /** Las llamadas que volvieron con `ok: false`: argumentos resumidos y el
   *  motivo LITERAL que leyó el modelo. Ausente si no hubo ninguna. */
  tropiezos?: string[];
  /** Con `enNavegador`, la línea de lo medido USANDO la página. */
  enNavegador?: string;
  /** El texto con el que el modelo cerró el turno. Sólo si el caso lo pide con
   *  `verCierre`: es para LEERLO, no para puntuar. */
  cierre?: string;
  /** Cómo acabó el objetivo, si el caso llevaba uno.
   *
   *  🔴 SIN ESTO, UN «PASS» NO DICE CUÁNTO COSTÓ. La primera corrida con
   *  objetivo (2026-09-07) salió verde y no hubo forma de saber si se cumplió a
   *  la primera o quemó las dos vueltas extra — y cada vuelta es una llamada
   *  del papel caro. Un veredicto que no dice lo que gastó obliga a pagar otra
   *  corrida para averiguarlo. */
  objetivo?: { veredicto: string; razon: string; vueltasExtra: number };
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

// ⚰️ Aquí vivía `snapshotPerfilNegocio`, que fotografiaba el perfil ANTES de
// cada caso para poder decir si el turno había guardado algo de verdad. Se va
// con las dos herramientas que escribían ahí (2026-08-31).
//
// Su hermana `snapshotAgentMemory` SIGUE viva y por el mismo motivo: la memoria
// de usuario (`users.agentMemory`) sobrevive al perfil, y sin comparar contra
// el antes un dato del caso anterior daría por bueno un turno que no guardó
// nada.
export async function restoreAgentMemory(userId: string, previo: string | null): Promise<void> {
  await db
    .update(schema.users)
    .set({ agentMemory: previo })
    .where(eq(schema.users.id, userId));
}

/** Exportada para `scripts/agent-multiturno.ts`: ese conductor crea su propio
 *  proyecto de usar y tirar y tiene que poder limpiarlo con la MISMA función,
 *  no con un `delete` paralelo que un día divergiría de ésta. */
export async function deleteThrowawayProject(projectId: string): Promise<void> {
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
// `PromesasDelArnes`, `PUERTAS_CON_PRUEBA` y el anotador viven en
// `./promesas`, que NO importa `@/lib/db`. Ver la cabecera de ese fichero: es
// lo que deja que una prueba determinista componga el bucle de verdad con este
// envoltorio de verdad sin abrir una conexión contra producción.

// `PruebaEnEval` vive en `cases.ts` y no aquí: ese fichero es PURO y es el que
// declara la forma del `assert`, y las importaciones van de aquí hacia allá.

async function runLoopWithRetry(
  opts: RunEvalOptions,
  projectId: string,
  evalCase: EvalCase,
  verifyTurn?: AgentLoopArgs["verifyTurn"],
  medidas?: MedicionCruda[],
  avisos?: string[],
  tropiezos?: string[],
  promesas?: PromesasDelArnes,
): Promise<{ events: AgentStreamEvent[]; result: Awaited<ReturnType<typeof runAgentLoop>>; modelId: string }> {
  const deps = realDeps();
  // El arnés evalúa siempre sobre la Home, y esa suposición se escribe UNA vez.
  // Antes vivía dos veces —aquí implícita y abajo explícita—, que es la forma
  // exacta del hallazgo 1: dos capas decidiendo lo mismo por su cuenta.
  const sobre: Sobre = opts.sobre ?? "openlen";
  // 🔴 SIN `mirar_pagina`: este arnés no cablea `observarPagina`, así que
  // declararla era invitar al modelo a gastar una vuelta para recibir «no está
  // disponible en este entorno» — medido, 2 de 8 casos el 2026-09-21.
  const tools = herramientasDelSobre(
    buildFunctionDeclarations(process.env, { mirarPagina: false }),
    sobre,
  );
  let lastErr: unknown;
  let modelId = "";

  // UN NAVEGADOR POR CASO, igual que la ruta abre uno por request, y detrás el
  // mismo memo por documento. Perezoso: un caso sin `aviso` —o que no edita—
  // no arranca ningún Chromium.
  let poolDelCaso: Promise<VisualQualityRendererPool | null> | null = null;
  // El proyecto del caso nace sin subdominio y nada en el bucle publica (lo
  // vigila el invariante de `publishedAt`), así que se SABE que no tiene: el
  // sustituto de /api/d juzga `/api/d/<sub>/…` como en un borrador real. Misma
  // decisión que la ruta, que le pasa `project.subdomain`.
  const opcionesDeMedida = { sub: null };
  const medida = medirUnaVezPorDocumento(async (html: string) => {
    poolDelCaso ??= createVisualQualityRendererPool(1).catch(() => null);
    const pool = await poolDelCaso;
    return pool ? pool.render(html, opcionesDeMedida) : renderVisualQualityViewports(html, {}, opcionesDeMedida);
  });
  const medirDelCaso = medida.medir;
  const cerrarNavegadorDelCaso = async () => {
    const p = await poolDelCaso?.catch(() => null);
    await p?.close().catch(() => {});
  };

  try {
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
        prompt: evalCase.prompt,
        history: [],
        // LO QUE EL TALLER MANDA DE VERDAD y el arnés no sabía mandar: el
        // elemento señalado y la imagen adjunta. Sin ellos no se puede REPETIR
        // un turno real — «cámbiame esa sección» sin pin degenera en una
        // pregunta, y se acaba midiendo otro turno.
        ...(evalCase.scopePin ? { scopePin: evalCase.scopePin } : {}),
        ...(evalCase.attachedImage ? { attachedImage: evalCase.attachedImage } : {}),
        // 🔴 EL OBJETIVO TAMBIÉN VA AL CONTEXTO, no sólo al bucle.
        //
        // Abajo se le pasa a `runAgentLoop`, que es quien lo usa para el JUEZ.
        // Pero desde el 2026-09-09 la condición viaja además en el contexto del
        // MODELO, y este ensamblado es una SEGUNDA copia del de la ruta: sin
        // esta línea el arnés mediría un turno en el que Len no sabe cuál es su
        // objetivo — o sea, el comportamiento viejo, y diría que es el nuevo.
        //
        // Es el mismo par que ya vigila `aviso-medido.test.ts` para
        // `medirParaElModelo`: dos sitios arman el turno y tienen que armarlo
        // igual.
        ...(evalCase.objetivo ? { objetivo: { condicion: evalCase.objetivo.condicion } } : {}),
        maxPromptTokens: MAX_PROMPT_TOKENS,
      });
      if (!built.ok) throw new Error("fixture too large for a turn (unexpected)");
      // EL SOBRE, y SÓLO el sobre. Se cambia el mensaje de sistema y nada más:
      // el bloque de contexto —el documento etiquetado, el estado del
      // proyecto— son DATOS, y los dos brazos tienen que recibir los mismos o
      // esto dejaría de medir el sobre para medir dos entradas distintas.
      const messages =
        sobre === "minimo"
          ? [{ ...built.messages[0], content: PROMPT_MINIMO }, ...built.messages.slice(1)]
          : built.messages;

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
        mensajeDelUsuario: evalCase.prompt,
      };

      // El MISMO cerebro que la ruta. Aquí vivía una copia de su elección de
      // proveedor, y cuando el Agente pasó a DeepSeek la copia se quedó midiendo
      // Gemini sin que nada fallara: la batería habría certificado un modelo que
      // el producto ya no usa.
      const brain = createAgentBrain({ tools, requestId: projectId, signal: abort.signal });
      modelId = brain.modelId;
      const result = await runAgentLoop({
        messages,
        tools,
        // El presupuesto del caso, si lo declara. Sin esto no hay forma de
        // llegar al cierre por tope sin quemar seis vueltas pagadas.
        ...(evalCase.maxTurns !== undefined ? { maxTurns: evalCase.maxTurns } : {}),
        // EL OBJETIVO, con el evaluador DE PRODUCCIÓN enchufado. Medir un juez
        // distinto del que correría de verdad sería medir otra cosa — la misma
        // regla que gobierna el resto de este fichero.
        ...(evalCase.objetivo
          ? {
              objetivo: {
                condicion: evalCase.objetivo.condicion,
                maxVueltas: evalCase.objetivo.maxVueltas,
                evaluar: (o: { condicion: string; transcript: string }) => evaluarCondicion(o),
              },
            }
          : {}),
        // 🔴 EL AVISO SE CAPTURA AQUÍ, DE LOS MENSAJES QUE EL MODELO VA A VER.
        //
        // Es el único sitio donde se puede leer LITERAL lo que se le dijo sin
        // volver a componerlo: el sobre lo arma el bucle (`redactarAviso` /
        // `medicionLimpia`) y recomponerlo en el arnés sería una segunda copia
        // de la decisión — el defecto que este repo ya ha pagado varias veces.
        //
        // Sin esto un caso con `aviso` devolvía un PASS MUDO: no se distinguía
        // «el modelo lo escribió bien a la primera» de «lo escribió mal y lo
        // arregló porque se lo dijimos», que son resultados opuestos. Medido el
        // 2026-09-08 con `color-desde-una-clase`: PASS, y no había forma de
        // saber cuál de las dos había pasado.
        //
        // La marca es la del sobre, y la comparten sus dos formas —la que
        // reporta defectos y la que dice «medido, y limpio»—, así que esto
        // captura las dos.
        openStream: (msgs) => {
          if (avisos) {
            for (const m of msgs) {
              const c = typeof m.content === "string" ? m.content : "";
              if (c.includes("<medido-tras-editar>") && !avisos.includes(c)) avisos.push(c);
            }
          }
          return brain.openStream(msgs);
        },
        closeOut: (msgs) => brain.closeOut(msgs),
        // 🔴 EL TEXTO DEL ERROR, que el evento no trae. La tarjeta dice
        // `editar_html!` y nada más; el motivo sólo existe en la respuesta que
        // vuelve al modelo. MEDIDO el 2026-09-17: dos corridas pagadas enseñaron
        // «la primera declaración del almacén falla» sin poder decir POR QUÉ —
        // y adivinarlo a ciegas cuesta una corrida por hipótesis.
        // EL MISMO ENVOLTORIO QUE PRUEBA `promesas-del-arnes.test.ts`, no una
        // copia suya: lo único que se inyecta aquí es CÓMO se ejecuta la
        // herramienta. Si esto volviera a escribirse en línea, la prueba
        // determinista seguiría verde midiendo un envoltorio que ya no corre.
        runTool: anotarPromesas({
          session,
          ejecutar: (name, args) => runAgentTool(session, deps, name, args),
          ...(promesas ? { promesas } : {}),
          ...(tropiezos ? { tropiezos } : {}),
        }),
        // P3 visual: los ojos encendidos, paridad con producción — el
        // auto-arreglo in-loop cuenta como parte del comportamiento medido.
        ...(verifyTurn ? { verifyTurn } : {}),
        // LO MEDIDO DE VUELTA AL MODELO, armado como en la ruta: las fotos del
        // dueño dentro del documento, y una medida por documento (el memo,
        // `medirUnaVezPorDocumento`) para no renderizar dos veces lo mismo.
        // El caso puede pedirlo por su cuenta, igual que `objetivo`. La opción
        // de corrida sigue valiendo para encenderlo en TODA la batería (un
        // experimento), pero sin esta primera mitad el aviso dependía de una
        // bandera que ningún runner pasaba — ver `EvalCase.aviso`.
        ...(evalCase.aviso || opts.aviso
          ? {
              medirParaElModelo: async (gemelo: string) => {
                // La MISMA composición que producción (`app/api/agent/route.ts`),
                // por la misma función: normaliza `runtimeErrors` y añade el
                // cuarto eje. Un arnés que compone la medición por su cuenta
                // mide otra cosa — es la regla de la cabecera de este fichero.
                const m = componerMedicion(await medirDelCaso(await inlineOwnAssets(gemelo)), gemelo);
                // LA LÍNEA BASE NO ES UNA TANDA. El bucle la mide por esta misma
                // dependencia (con el documento del ARRANQUE), así que sin este
                // filtro se colaría en la secuencia y la leería como «el modelo
                // volvió a editar» — justo la distinción para la que existe
                // `medidas`. Se reconoce por el documento: la base es el que la
                // sesión tenía antes de tocar nada.
                if (m && gemelo !== taggedHtml) medidas?.push(m);
                return m;
              },
              // El brazo de control apaga la base y deja la medición: ver
              // `sinLineaBase`.
              // El caso puede apagar la base por su cuenta, como pide el aviso:
              // `opts.sinLineaBase` no la pasaba ningún runner. Ver
              // `EvalCase.sinLineaBase`.
              ...(evalCase.sinLineaBase || opts.sinLineaBase
                ? {}
                : { lineaBase: { taggedHtml, page: null } }),
            }
          : {}),
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
  } finally {
    // Se cierra SIEMPRE. Un Chromium colgado por caso, con 56 casos, es la
    // batería llenando el disco de la máquina de Jesús.
    await cerrarNavegadorDelCaso();
  }
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
  const started = Date.now();

  // P3 — eje visual: el recorder captura el veredicto in-loop (los ojos) y su
  // gasto; tras el loop, el estado FINAL se juzga (reusando el veredicto
  // in-loop cuando ya juzgó exactamente ese estado).
  // La memoria de las promesas de esta corrida. Ver `PromesasDelArnes`.
  const promesas: PromesasDelArnes = { spec: null, js: null, suite: [], declaradas: [] };
  let inLoopVerdict: VisualVerdict | null = null;
  let visionIn = 0;
  let visionOut = 0;
  const judge = async (html: string): Promise<VisualVerdict> => {
    const v = await verifyEditedPage({
      html,
      userPrompt: evalCase.prompt,
      // COMO LA RUTA: la promesa de ESTE turno y las que la página ya
      // cumplió. Sin las dos, el arnés no comprueba comportamiento —ni el
      // declarado ni el que ya funcionaba— y aprueba por no haber mirado.
      spec: promesas.spec,
      // LA OTRA RUTA, que la ruta de producción pasa desde el 2026-09-04 y el
      // arnés no pasaba: sin esto una promesa escrita en JavaScript no se
      // EJECUTA en la batería, y el caso la da por buena sin haberla corrido.
      pruebaJs: promesas.js,
      guardadas: vivas(promesas.suite, html, null),
      // PARIDAD CON LA RUTA, que es la única promesa de este fichero: allí los
      // ojos miden el documento de vista, así que aquí también. Sin esto el
      // arnés mediría una página sin la burbuja del chat y el marcador se
      // movería por una diferencia nuestra.
      vista: vistaParaMedir(projectId, { title: `Agent Eval ${evalCase.id}`, data }, null),
    });
    visionIn += v.usage?.inputTokens ?? 0;
    visionOut += v.usage?.outputTokens ?? 0;
    return v;
  };
  const verifyTurn: AgentLoopArgs["verifyTurn"] | undefined = opts.visual
    ? async ({ html }) => {
        const v = await judge(html);
        inLoopVerdict = v;
        // LA SUITE, COMO EN LA RUTA: se marca lo que se rompió, se retira
        // lo que ya no señala a nada, y entra la promesa que nació en verde.
        // Aquí vive en memoria —el arnés no escribe `data.pruebas`— pero
        // cruza los turnos de una corrida, que es lo que hace falta para
        // medir una regresión.
        // Las que NO corrieron no cuentan como comprobadas (ver
        // `VisualVerdict.guardadasSinCorrer`).
        const sinCorrer = new Set(v.guardadasSinCorrer ?? []);
        const comprobadas = vivas(promesas.suite, html, null)
          .filter((p) => !sinCorrer.has(p.id))
          .map((p) => p.id);
        const { suite: marcadas } = marcarRegresiones(promesas.suite, {
          comprobadas,
          rotas: (v.regresiones ?? []).map((r) => r.id),
        });
        promesas.suite = actualizarSuite(marcadas, {
          retirar: [...(v.retirarPruebas ?? [])],
          documento: html,
          pagina: null,
          // COMO LA RUTA: la promesa del turno entra como programa JS, venga
          // por `prueba_js` o convertida desde el DSL.
          ...((): { turno?: { codigo: string; fallos: readonly FalloSpec[]; pagina: null } } => {
            const codigo = promesas.js?.trim() || (promesas.spec?.length ? pasosAJs(promesas.spec) : null);
            return codigo ? { turno: { codigo, fallos: v.fallosDelTurno ?? [], pagina: null } } : {};
          })(),
        });
        // Y LOS CUATRO ESTADOS, no dos: colapsar `observado` y `no_mirado`
        // en `bien` es medir un producto que no existe — allí una
        // observación se le dice al usuario, y un «no pude mirar» no es un
        // aprobado.
        const conRegresiones = <T extends VerifyOutcome>(salida: T): T =>
          v.regresiones?.length ? { ...salida, regresiones: v.regresiones } : salida;
        if (v.fallback) {
          return conRegresiones({
            estado: "no_mirado" as const,
            motivo: "la verificación no pudo correr",
          });
        }
        if (v.broken) {
          return conRegresiones({
            estado: "roto" as const,
            critique: v.issues.map((i) => `- ${i}`).join("\n"),
          });
        }
        if (v.observaciones.length > 0) {
          return conRegresiones({ estado: "observado" as const, notas: v.observaciones });
        }
        return conRegresiones({ estado: "bien" as const, conMedida: v.conMedida });
      }
    : undefined;

  try {
    const medidas: MedicionCruda[] = [];
    // Lo que se le DIJO al modelo, literal. Ver la captura en `openStream`.
    const avisos: string[] = [];
    // Las llamadas que volvieron con `ok: false`, con su motivo. Ver `runTool`.
    const tropiezos: string[] = [];
    const { events, result, modelId } = await runLoopWithRetry(
      opts,
      projectId,
      evalCase,
      verifyTurn,
      medidas,
      avisos,
      tropiezos,
      promesas,
    );

    // Re-read the FULL row: the case assert only sees ProjectData, so the
    // publishedAt + userBrief COLUMN invariants are enforced here.
    const rows = await db
      .select({
        data: schema.projects.data,
        userBrief: schema.projects.userBrief,
        publishedAt: schema.projects.publishedAt,
        subdomain: schema.projects.subdomain,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    const finalRow = rows[0];
    const finalData: ProjectData = finalRow?.data ?? data;

    // ─── ¿SE CUMPLIÓ LO QUE PROMETIÓ? (2026-09-21) ────────────────────────
    //
    // 🔴 EL HUECO QUE ESTO CIERRA. La prueba declarada se EJECUTA dentro del
    // render, que es gratis —Chromium, cero créditos—, pero vivía pegada al
    // crítico de pago: `verifyTurn` sólo se armaba con `--visual`, así que una
    // corrida normal **no ejecutaba ni una sola prueba declarada**. Sin esto,
    // afirmar sobre `pruebas` mide lo que el modelo DECLARÓ, no lo que la
    // página CUMPLIÓ, y llamar a eso verificación sería el defecto de siempre.
    //
    // ⚠️ VA AQUÍ Y NO DENTRO DEL BUCLE, a propósito. Encender `verifyTurn`
    // siempre metería mensajes nuevos en el turno y **la batería histórica
    // dejaría de ser comparable consigo misma** — es el mismo motivo por el que
    // `visual` y `aviso` están apagados por omisión (ver `RunEvalOptions`).
    // Contra el estado FINAL, que además es el que juzga el `assert`.
    //
    // Sólo cuando hay algo que comprobar: sin promesa declarada esto no
    // renderizaría nada útil y costaría segundos por caso a cambio de nada.
    // UN SOLO RENDER para las dos cosas: la promesa declarada y los hechos
    // mecánicos. Los dos salen del mismo `conHechos`, así que pedirlos por
    // separado sería pagar dos veces los mismos segundos.
    const muto = events.some((e) => e.type === "html");
    let cumplimiento: EvalCumplimiento | null = null;
    /** Lo que devolvió la promesa de la RANURA JS al ejecutarse. Mide y NO
     *  puntúa — ver dónde se llena. */
    let pruebaJsFallos: readonly FalloSpec[] | undefined;
    let hechos: EvalHechos | undefined;
    // 🔴 `promesas.js` ENTRA EN LA CONDICIÓN, o la ranura JS se cuela sin medir.
    // Sin él, una promesa en JavaScript de un turno que no emitió evento `html`
    // no llegaba a `verifyEditedPage`, `cumplimiento` se quedaba en null y
    // `prometioYSeComprobo` la dejaba pasar por su escape de `jsFinal` — el pase
    // libre otra vez, por la puerta de atrás.
    if (finalData.html && (promesas.spec?.length || promesas.js || muto)) {
      try {
        const v = await verifyEditedPage({
          html: finalData.html,
          userPrompt: evalCase.prompt,
          spec: promesas.spec,
          // Ver la llamada de `judge`: sin esto la ranura JS se declara y no se
          // corre, y `cumplimiento` se queda en null con la promesa sin mirar.
          pruebaJs: promesas.js,
          guardadas: vivas(promesas.suite, finalData.html, null),
          vista: vistaParaMedir(
            projectId,
            { title: `Agent Eval ${evalCase.id}`, data: finalData },
            null,
          ),
          // LA LÍNEA ENTERA DE ESTE CAMBIO: los hechos sí, la opinión no.
          sinVision: true,
        });
        // QUIÉN DE LAS DOS RUTAS SE JUZGA — la decisión vive en
        // `cumplimientoDelTurno`, que es puro y tiene sus pruebas. Aquí sólo se
        // le pasa lo medido. El detalle de la ruta JS viaja aparte, para el
        // informe: `cumplimiento` dice SI se cumplió, `pruebaJsFallos` QUÉ falló.
        if (promesas.js) pruebaJsFallos = v.fallosDelTurno ?? [];
        cumplimiento = cumplimientoDelTurno({
          js: promesas.js,
          spec: promesas.spec,
          fallos: v.fallosDelTurno ?? [],
          vacuas: v.vacuasDelTurno ?? [],
          corrio: true,
        });
        // 🔴 SIN VISIÓN, `broken` ES PURAMENTE MECÁNICO. Lo ponen cuatro hechos
        // de Chromium y ninguno es una opinión: el JavaScript que revienta
        // (`verify.ts:1151`), datos que el servidor rechazaría (1253), el
        // desborde a 390 px (1262) y el contraste leído del PÍXEL (1299). Los
        // fallos de spec se sacaron de `broken` el 2026-09-04 tras medir que
        // acusaban 0 de 3, y siguen fuera — aquí viajan aparte, en `cumplimiento`.
        hechos = { roto: v.broken, issues: v.issues.slice(0, 6), scored: false };
      } catch (err) {
        // Un render que revienta NO reprueba el caso: no medir no es medir mal,
        // que es la regla fail-open de la prueba declarada desde que existe.
        // Vale igual para la ranura JS ahora que puntúa: `corrio: false` con
        // `fallos: []` no acusa a nadie (`promesaIncumplida` exige `corrio`), y
        // `pruebaJsFallos` se queda AUSENTE, que es «no se midió» — distinto de
        // un `[]`, que diría «corrió y salió limpia».
        cumplimiento = cumplimientoDelTurno({
          js: promesas.js,
          spec: promesas.spec,
          fallos: [],
          vacuas: [],
          corrio: false,
          // EL MOTIVO, que este `catch` se tragaba. Sin él el informe decía «2
          // declararon, 1 se ejecutó» y la otra desaparecía sin explicación.
          motivo: `el render reventó: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160),
        });
      }
    }

    // 🔴 `pruebas` ENTRA AQUÍ (2026-09-21). Hasta hoy el `assert` recibía tres
    // cosas y la prueba declarada no era ninguna: vivía en `session.behaviorSpec`,
    // que no viaja en `data`, ni en `events`, ni en `result`. Medido ese día:
    // de las 13 reglas de `RUNTIME_MANDA_PRUEBA`, CERO tenían un caso capaz de
    // cazar su violación, y ésta era la primera de las cuatro causas — ningún
    // caso PODÍA afirmar sobre `prueba` aunque quisiera.
    let reason = evalCase.assert({
      cumplimiento,
      data: finalData,
      events,
      result,
      pruebas: promesas.declaradas,
    });

    // 🔴 LA PROMESA, MEDIDA EN LOS 65 — Y SIN PUNTUAR EN 62 DE ELLOS.
    //
    // Sólo TRES casos llaman a `prometioYSeComprobo` dentro de su `assert`, así
    // que en los otros 62 el modelo puede editar el comportamiento sin prometer
    // nada y nadie se entera. El instrumento existe; la batería casi no lo usa.
    //
    // 🔴 LA FORMA ES LA QUE YA USA `EvalHechos`: un medidor CORRE Y SE ENSEÑA
    // sin entrar en el score. Eso es lo que permite medir los 62 sin cambiar
    // hoy el significado del marcador histórico. Y lo que viaja es la FRASE
    // entera de `prometioYSeComprobo`, no un booleano: un veredicto sin
    // evidencia no se puede auditar después.
    //
    // Promoverlo a puerta es UNA línea (meterlo en `reason`) y necesita el
    // número de una corrida limpia, no ganas — la misma regla que `EvalHechos`.
    const promesaMedida = prometioYSeComprobo({
      cumplimiento,
      pruebas: promesas.declaradas,
    });

    // LO QUE SÓLO SE VE USÁNDOLO. Corre aunque el texto ya haya suspendido: su
    // línea de detalle es lo que se cuenta entre corridas.
    let enNavegador: string | undefined;
    if (evalCase.enNavegador && finalData.html) {
      try {
        const v = await evalCase.enNavegador(finalData.html, { sub: finalRow?.subdomain ?? null });
        enNavegador = v.detalle;
        if (reason === null && v.fallo) reason = v.fallo;
      } catch (err) {
        enNavegador = `no se pudo probar en el navegador: ${err instanceof Error ? err.message : String(err)}`;
        if (reason === null) reason = enNavegador;
      }
    }

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
      thinkingTokens: result.usage.thinkingTokens,
      modelId,
      seconds: (Date.now() - started) / 1000,
      ...(visual ? { visual } : {}),
      // NO toca el `pass` de arriba, y ésa es la línea entera de esto.
      ...(hechos ? { hechos } : {}),
      ...(cumplimiento ? { cumplimiento } : {}),
      ...(promesas.js ? { pruebasJs: promesas.js } : {}),
      ...(pruebaJsFallos ? { pruebaJsFallos } : {}),
      ...(promesas.declaradas.length > 0 ? { declaradas: promesas.declaradas } : {}),
      ...(promesaMedida ? { promesaMedida } : {}),
      ...(medidas.length > 0 ? { medidas } : {}),
      ...(avisos.length > 0 ? { avisos } : {}),
      ...(tropiezos.length > 0 ? { tropiezos } : {}),
      ...(enNavegador !== undefined ? { enNavegador } : {}),
      // 🔴 UNA LÍNEA POR LLAMADA, NO DOS. El bucle emite un `running` al empezar
      // cada llamada y otro evento al terminarla, y contando los dos cada
      // llamada salía DOBLE en el informe. Las llamadas van en serie, así que
      // el único `running` que se queda es el ÚLTIMO: la llamada que el corte
      // pilló a medias, que no debe desaparecer.
      llamadas: (() => {
        const acciones = events.filter(
          (e): e is Extract<AgentStreamEvent, { type: "action" }> => e.type === "action",
        );
        return acciones
          .filter((e, i) => e.status !== "running" || i === acciones.length - 1)
          .map((e) => {
            const s2 = (e as { summary?: string }).summary;
            // El ÁMBAR también se marca: una llamada que se aplicó con aviso
            // se leía igual que una limpia, y los asserts sí las distinguen.
            const motivo = (e as { motivo?: string }).motivo;
            const marca =
              e.status === "error"
                ? "!"
                : e.status === "running"
                  ? " [sin terminar]"
                  : e.status === "warning"
                    ? ` [ámbar${motivo ? `: ${motivo.slice(0, 90)}` : ""}]`
                    : "";
            return `${e.tool}${marca}${s2 ? ` (${s2.slice(0, 40)})` : ""}`;
          });
      })(),
      ...(() => {
        const t = events.find((e) => e.type === "confirm" && (e as { action?: string }).action === "objetivo") as
          | { condicion?: string }
          | undefined;
        return t ? { propuso: t.condicion ?? "" } : {};
      })(),
      ...(evalCase.verCierre && result.finalText ? { cierre: result.finalText } : {}),
      ...(result.objetivo ? { objetivo: result.objetivo } : {}),
    };
  } catch (err) {
    return {
      id: evalCase.id,
      pass: false,
      reason: `excepción: ${String((err as { message?: unknown })?.message ?? err).slice(0, 160)}`,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
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
