import { auth } from "@/auth";
import { createProject } from "@/lib/projects";
import { resolveProfileForCreation } from "@/lib/business-profiles/store";
import type { BusinessProfile, BusinessProfileData } from "@/lib/business-profiles/types";
import { createVersion } from "@/lib/projects/versions";
import { getCreditState } from "@/lib/credits";
import { systemPromptFor } from "./system-prompt";
import { modelRuntimePromptBlock } from "@/lib/ai-stream/model-runtime";
import { randomUUID } from "node:crypto";
import { appendChatMessage } from "@/lib/projects/chat";
import { modelPruebaPromptBlock } from "@/lib/ai-stream/model-prueba";
import type { PasoSpec } from "@/lib/agent/behavior-spec";
import { detectSlotPath } from "@/lib/html-engine";
import { collectDegradations } from "@/lib/ingestion/degradations";
import { directionToBriefBlock, type StyleDirection } from "@/lib/style-match/direction";
import { disableCalcRegions } from "@/lib/expr/repair";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";
import { generateHtmlStream, pageWriterUsesDeepSeek } from "@/lib/ai-stream/generate";
import { critiqueGeneratedPage } from "@/lib/ai/vision-critique";
import { repairGeneratedPage } from "@/lib/generation/repair-pass";
import { recordCriticRun, recordRegenOutcome } from "@/lib/ai/quality-metrics";
import type { InlineImage, Message } from "@/lib/ai-gateway";
import { preparePage } from "@/lib/page-engine/prepare";
import { buildBusinessFacts } from "@/lib/business-profiles/facts";
import { jsonResponse, sseChannel } from "@/lib/ai/sse";
import { extractDocument } from "@/lib/ai/extract-document";
import { LANGUAGE_RULE } from "@/lib/ai/authoring-rules";
import { todayLine } from "@/lib/ai/today-line";
import {
  PLAN_LIMITS,
  checkAndConsume,
  getUserPlan,
  userLimitKey,
} from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate — free-form AI landing-page generation.
//
// Body: { brief: string, model?: "gemini-pro" | "gemini-flash" }
//
// Streams Server-Sent Events as Gemini writes the page:
//   html_chunk    { text }              — sanitized HTML deltas (post-F3 S4)
//   progress      { chars }             — server→client keepalive
//   project_saved { projectId, title }  — terminal success
//   error         { message }
//
// Pipeline (F3 cutover, 2026-05-27):
//   GeminiProvider stream → HtmlStream (sanitize + normalize on end) →
//   SSE wrapper. Credits debit on the upstream `usage` event inside
//   generateHtmlStream; this route only does pre-flight balance gate +
//   post-flight project save. The legacy `reasoning_chunk` + `---HTML---`
//   marker scheme from the Kimi era was dropped — Gemini's
//   instruction-tuning makes raw-HTML output reliable from the first
//   byte.
// ─────────────────────────────────────────────────────────────────────────────



// Sin catálogo de gusto. Aquí viajaba un segundo mensaje `<reference>` con las
// recetas de CSS, cinco fragmentos de HTML de la plantilla Mirror y los
// catálogos de marcas, presentado al modelo como "the design taste catalog".
// El system prompt ya no lo llevaba, pero esto sí — y por eso una guarda que
// sólo miraba el system prompt pasaba en verde.

/** La dirección visual que el cliente adjunta, validada campo a campo.
 *
 *  Nada de confiar en la forma: esto acaba dentro del prompt, y un objeto con
 *  un `character` de 50.000 caracteres o una paleta de mil entradas sería una
 *  forma barata de inflar cada generación. `directionToBriefBlock` recorta al
 *  final, pero recortar es la última red, no la primera. */
function parseStyleDirection(body: unknown): StyleDirection | null {
  const raw = (body as { styleDirection?: unknown })?.styleDirection;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const palette = Array.isArray(d.palette)
    ? d.palette
        .filter(
          (p): p is { role: string; hex: string } =>
            !!p && typeof p === "object" &&
            typeof (p as { hex?: unknown }).hex === "string" &&
            /^#[0-9a-f]{6}$/i.test((p as { hex: string }).hex) &&
            typeof (p as { role?: unknown }).role === "string",
        )
        .slice(0, 6)
        .map((p) => ({ role: p.role.slice(0, 24), hex: p.hex }))
    : [];
  if (palette.length === 0) return null;
  const radius = ["sharp", "soft", "rounded", "pill"].includes(String(d.radius))
    ? (d.radius as StyleDirection["radius"])
    : "soft";
  const character = typeof d.character === "string" && d.character.trim().length >= 10
    ? d.character.trim().slice(0, 320)
    : undefined;
  return {
    hostname: "",
    palette,
    polarity: d.polarity === "dark" ? "dark" : "light",
    fontFamily: typeof d.fontFamily === "string" ? d.fontFamily.slice(0, 60) : "sans-serif",
    radius,
    ...(character ? { character } : {}),
  };
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const brief =
    body &&
    typeof body === "object" &&
    typeof (body as { brief?: unknown }).brief === "string"
      ? (body as { brief: string }).brief.trim()
      : "";
  if (brief.length < 10 || brief.length > 4000) {
    return json({ error: "brief must be 10–4000 characters" }, 400);
  }
  // eslint-disable-next-line no-console
  console.log(`[generate] request — ${brief.length} chars`);

  const modelParam =
    body &&
    typeof body === "object" &&
    typeof (body as { model?: unknown }).model === "string"
      ? (body as { model: string }).model
      : undefined;

  const profileId =
    body &&
    typeof body === "object" &&
    typeof (body as { profileId?: unknown }).profileId === "string"
      ? (body as { profileId: string }).profileId
      : null;

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Auth required — anonymous /api/generate would let anyone burn API
  // credits without ever creating an account.
  if (!userId) return json({ error: "unauthorized" }, 401);

  const plan = await getUserPlan(userId);

  // Aquí vivía una puerta PRO. Rechazaba a todo usuario free y lo mandaba al
  // "Quick (curated) flow" — que era /api/curate, la ruta de composición por
  // secciones, borrada con el catálogo entero. El mensaje señalaba a un sitio
  // que ya no existe: un usuario nuevo se encontraba un muro y ninguna salida.
  //
  // Y el presupuesto para dejarlo pasar ya estaba puesto y medido: el plan free
  // trae 20 créditos al mes (lib/credits.ts) y 5 generaciones por hora
  // (PLAN_LIMITS.free). Con el costo real —0.16 MXN por página, medido sobre
  // las doce del cohorte de evals— eso no es una fuga, es lo que se presupuestó.
  //
  // Lo que separa free de pro se queda donde ya estaba: el tope por hora y los
  // créditos, no la puerta.

  // Quota check — hourly + monthly windows defined in lib/limits.ts.
  const decision = await checkAndConsume(
    userLimitKey(userId, "generate"),
    PLAN_LIMITS[plan].generate,
  );
  if (!decision.ok && decision.blocked) {
    return new Response(
      JSON.stringify({
        error: "quota_exceeded",
        scope: decision.blocked.label,
        plan,
        max: decision.blocked.max,
        windowMs: decision.blocked.windowMs,
        resetAt: decision.resetAt?.toISOString(),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil(
                ((decision.resetAt?.getTime() ?? Date.now() + 60000) -
                  Date.now()) /
                  1000,
              ),
            ),
          ),
        },
      },
    );
  }

  const PROVIDER = resolveAIProvider(modelParam);
  if (!PROVIDER.key) {
    return json({ error: `${PROVIDER.label} API key missing` }, 500);
  }
  const aiModel: AIModel = modelParam === "gemini-pro" ? "gemini-pro" : "gemini-flash";

  // Resolve the saved business profile up front so we can feed its real facts
  // into the prompt AND seed the finished HTML. resolveProfileForCreation always
  // returns a profile (lazy default); an empty one changes nothing downstream.
  // Best-effort — a resolve failure just yields an unseeded page, never a
  // failed generation.
  let profile: BusinessProfile | null = null;
  try {
    profile = await resolveProfileForCreation(userId, profileId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[generate] profile resolve failed — generating unseeded", err);
  }

  // Sin referencia adjunta, a propósito. Aquí se elegía una plantilla curada,
  // se le mandaba la captura y se le decía "iguala su calidad, densidad,
  // disciplina de espaciado y pulido" — nuestra página otra vez, por otra
  // puerta. Y tenía un efecto que nadie veía: una imagen adjunta fija el turno
  // a Gemini, porque el papel que razona en Fireworks no tiene ojos. Medido en
  // un e2e: `reference template: daybreak` seguido de `calling Gemini 3.5
  // Flash`. Quitarla es lo que deja escribir a DeepSeek.
  let briefBlock = `BRIEF:
${brief}`;

  // ── referencia visual ("hazme una como esta") ─────────────────────────────
  // El cliente manda la DIRECCIÓN (el objeto), no el texto ya montado: el
  // bloque se reconstruye AQUÍ con `directionToBriefBlock`, así que su techo de
  // 900 caracteres y su redacción los garantiza el servidor. Aceptar el texto
  // hecho sería dejar que el cliente decidiera cuánto prompt gasta.
  //
  // Y viaja como TEXTO, nunca como imagen — ver el comentario de arriba: una
  // imagen adjunta fija el turno a Gemini y DeepSeek deja de escribir la
  // página. Qwen ya miró la captura en `/api/style-reference`; lo que llega
  // aquí es su conclusión, no la foto.
  const direction = parseStyleDirection(body);
  if (direction) {
    briefBlock = `${directionToBriefBlock(direction)}

${briefBlock}`;
    // eslint-disable-next-line no-console
    console.log(`[generate] referencia visual — ${direction.palette.length} colores${direction.character ? " + carácter" : ""}`);
  }

  // Soft-seed the prompt with the user's REAL business facts (if any) so the
  // generated COPY uses them instead of inventing. Empty profile → no block,
  // page is generated exactly as before.
  const businessFacts = profile ? buildBusinessFacts(profile.data) : null;
  if (businessFacts) {
    briefBlock = `${businessFacts}\n\n${briefBlock}`;
  }

  const messages = [
    { role: "system" as const, content: systemPromptFor(process.env) + modelRuntimePromptBlock(process.env) + modelPruebaPromptBlock(process.env) },
    { role: "user" as const, content: `${todayLine()}${LANGUAGE_RULE}${briefBlock}` },
  ];

  const upstreamAbort = new AbortController();

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const channel = sseChannel(controller);
      const emit = channel.emit;
      let keepalive: ReturnType<typeof setInterval> | null = null;
      const closeStream = () =>
        channel.close(() => {
          if (keepalive) {
            clearInterval(keepalive);
            keepalive = null;
          }
        });

      let totalHtmlChars = 0;
      // Server-to-client keepalive — emit a progress event every 5s so
      // the client watchdog stays reset even if Gemini is silent during
      // its initial "thinking" phase. Cleared in closeStream.
      keepalive = setInterval(() => {
        emit("progress", { chars: totalHtmlChars });
      }, 5000);

      try {
        // Credit gate — one credit is enough to start; the real cost is
        // metered + debited inside generateHtmlStream on the `usage` event.
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", {
            message:
              "Te quedaste sin créditos este mes. Esperá al reset mensual o pasá a Pro.",
          });
          closeStream();
          return;
        }

        // eslint-disable-next-line no-console
        console.log(
          // Quién escribe de verdad, no quién resolvió la clave: el label del
          // proveedor decía "Gemini 3.5 Flash" mientras DeepSeek escribía la
          // página, y sólo la aritmética de créditos lo desmentía.
          `[generate] auth + quota + credits ok — escribe ${pageWriterUsesDeepSeek() ? "DeepSeek" : PROVIDER.label}`,
        );

        // One generation pass: stream HTML chunks to the client, await the
        // canonical post-process HTML, then validate it. Returns the validated
        // document or a user-facing error message. Used for both the initial
        // pass and the (optional) critic-driven regen — the regen re-streams
        // so the live preview shows the better version coming together.
        const runPass = async (
          genMessages: Message[],
          label: string,
        ): Promise<
          | { ok: true; html: string; modelRuntime: string | null; modelPrueba?: readonly PasoSpec[] }
          | { ok: false; message: string; retryable: boolean }
        > => {
          const { stream, done } = generateHtmlStream({
            apiKey: PROVIDER.key as string,
            messages: genMessages,
            model: aiModel,
            userId,
            signal: upstreamAbort.signal,
            // Fresh pages have no need for op-ids; they're a chat-tab
            // protocol marker injected at edit time by tagWithOpIds. Saving
            // them with the project bloats every row and re-tagging on every
            // chat turn would still rewrite them, so leave them off.
            htmlOpts: { injectOpIds: false },
            maxOutputTokens: 65_536,
            temperature: 0.8,
          });

          // Pipe per-write HTML chunks to the SSE client as `html_chunk`
          // events. HtmlStream already sanitizes + applies the born-canonical
          // marker pass on end(); the chunks here are the same bytes the
          // final document will contain (sans normalize-time rewrites).
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let loggedFirst = false;
          // LA VALLA DE MARKDOWN. El modelo abre con ```html de vez en cuando
          // pese a que el contrato se lo prohíbe. `extractDocument` la quita
          // del documento FINAL —por eso la página entregada sale bien— pero
          // los trozos del streaming iban crudos al cliente, así que el usuario
          // veía «```html» colgado arriba a la izquierda mientras su página se
          // dibujaba debajo. Cosmético, y aun así es lo primero que ve de su
          // página.
          //
          // La regla es la misma que aplica `extractDocument`, sólo que en
          // vivo: un documento empieza en `<`. Lo que venga antes es prosa o
          // valla, nunca contenido, así que se tira hasta el primer `<` y a
          // partir de ahí se emite tal cual. Sirve igual si la valla llega
          // partida en dos trozos —lo único que se mira es si ya apareció el
          // `<`— y no cuesta nada en el caso normal, donde el primer byte YA
          // es `<`.
          let empezoElDocumento = false;
          while (true) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
              chunk = await reader.read();
            } catch (readErr) {
              // The stream errored — break out and surface via `done`.
              // eslint-disable-next-line no-console
              console.error(`[generate] reader error (${label})`, readErr);
              break;
            }
            if (chunk.done) break;
            let text = decoder.decode(chunk.value, { stream: true });
            if (!empezoElDocumento) {
              const abre = text.indexOf("<");
              if (abre === -1) continue;
              text = text.slice(abre);
              empezoElDocumento = true;
            }
            if (text.length > 0) {
              if (!loggedFirst) {
                loggedFirst = true;
                // eslint-disable-next-line no-console
                console.log(`[generate] streaming started (${label})`);
              }
              totalHtmlChars += text.length;
              emit("html_chunk", { text });
            }
          }

          const summary = await done;

          if (summary.stopKind === "error" || !summary.finalHtml) {
            return {
              ok: false,
              message: summary.error?.message ?? "Generation failed — try again.",
              retryable: true,
            };
          }

          // Gemini occasionally wraps the output in ```html...``` fences
          // despite the system prompt forbidding it. Strip a possible fence
          // pair before validating — same safety net the Kimi-era route had.
          const passHtml = extractDocument(summary.finalHtml);

          if (passHtml.length < 1000 || !/^<!doctype/i.test(passHtml)) {
            return {
              ok: false,
              message:
                "The model didn't return a complete HTML document. Try again.",
              retryable: true,
            };
          }
          if (!/<\/html>\s*$/i.test(passHtml)) {
            return {
              ok: false,
              message:
                summary.stopKind === "max_tokens"
                  ? "The page hit the model's output cap before finishing. Try a shorter, more focused brief."
                  : "The page ended without a closing </html>. Try again.",
              // max_tokens is deterministic — same brief at same cap will hit
              // it again. Truncated streams from upstream congestion ARE
              // retryable.
              retryable: summary.stopKind !== "max_tokens",
            };
          }
          if (detectSlotPath(passHtml)) {
            return {
              ok: false,
              message: "The model emitted editor-mode markers — try again.",
              retryable: false,
            };
          }

          // eslint-disable-next-line no-console
          console.log(
            `[generate] tokens (${label}) — prompt: ${summary.usage?.inputTokens ?? "?"}, output: ${summary.usage?.outputTokens ?? "?"} → ${summary.creditsDebited} credits`,
          );
          // El runtime viaja con SU pasada. Si gana una regeneración, se guarda
          // el script de esa generación y no el de la anterior: un script escrito
          // para un DOM que ya no existe no falla — hace cosas raras en silencio.
          // La PRUEBA viaja con su pasada por la misma razón que el runtime: es
          // la promesa de ESE código sobre ESE DOM.
          return {
            ok: true,
            html: passHtml,
            modelRuntime: summary.modelRuntime,
            ...(summary.modelPrueba ? { modelPrueba: summary.modelPrueba } : {}),
          };
        };

        // ── Initial pass ────────────────────────────────────────────────────
        // Auto-retry ONCE on transient failures (truncated streams, garbage
        // output) — Gemini Flash cuts mid-document under load and a fresh
        // attempt usually completes. max_tokens / editor-markers are
        // deterministic and surface immediately. The user pays for the
        // tokens of both attempts on a retry, but that's a 1/20 occurrence
        // and the alternative is a hard "Generation failed" wall.
        let first = await runPass(messages, "initial");
        if (!first.ok && first.retryable) {
          // eslint-disable-next-line no-console
          console.log(
            `[generate] initial pass failed (${first.message}) — auto-retrying`,
          );
          first = await runPass(messages, "initial-retry");
        }
        if (!first.ok) {
          emit("error", { message: first.message });
          closeStream();
          return;
        }
        // ── Born With Imagery ───────────────────────────────────────────────
        // Swap real curated photos into the gradient image-placeholders the
        // model marked (data-ol-photo). Deterministic library match on the
        // model's subject hints — no extra AI call, no network. Soft-fail:
        // a hiccup just keeps the gradient placeholders.
        //
        // Va ANTES de medir y de juzgar, y se aplica a cada pasada. Corría al
        // final, así que el crítico veía los rellenos de gradiente: en una
        // corrida real puntuó la página quejándose de que faltaban fotos del
        // pan, con cuarenta y cinco fotos reales ya dentro. Lo que se juzga
        // tiene que ser lo que se entrega.
        //
        // Y las tres medidas mejoran con las fotos puestas: el contraste sobre
        // una foto es incierto a propósito —el detector se calla— y el
        // desborde se mide sobre la maqueta de verdad, no sobre un hueco.
        // Reuse the profile resolved up front (a save-time resolve only if
        // that failed).
        const business = profile ?? (await resolveProfileForCreation(userId));

        // El motor: imágenes → legibilidad → medición → invariantes → puerta →
        // módulos. Vive en lib/page-engine y lo comparten crear, editar y el
        // Agente. Esta ruta lo corre una vez por candidato; lo único que se
        // queda aquí es la decisión de regenerar, porque exige volver a llamar
        // al modelo y eso es presupuesto del usuario.
        const title = extractTitle(first.html) ?? brief.slice(0, 60).trim();
        // El runtime viaja con SU pasada, igual que arriba: el candidato que se
        // mide tiene que llevar el script que ESE candidato escribió. Sin él la
        // medición era ciega al modo de fallo que ninguna captura enseña — un
        // script que muere en el arranque deja una foto perfecta.
        // La PRUEBA declarada viaja con el runtime: el motor la ejecuta dentro
        // del navegador que ya abre para medir, en el hueco donde si no pulsa
        // los controles a ciegas.
        const engine = (candidate: string, runtime: string | null, prueba?: readonly PasoSpec[]) =>
          preparePage(candidate, {
            mode: "create",
            brief,
            title,
            profile: business.data,
            runtime,
            ...(prueba && prueba.length > 0 ? { prueba } : {}),
          });

        const prueba = first.modelPrueba;
        let prepared = await engine(first.html, first.modelRuntime, prueba);
        if (!prepared.ok) {
          // eslint-disable-next-line no-console
          console.error(`[generate] gate refused (${prepared.code}) — not saving`);
          emit("error", { message: "The page came out with editor-mode markers — try again." });
          closeStream();
          return;
        }
        let html = prepared.html;
        let runtimeCode = first.modelRuntime ?? null;
        let regenerated = false;
        let breakage = [...prepared.report.breakage];
        // Una fórmula que el reparador NO pudo arreglar sin adivinar entra en
        // el mismo reintento que la rotura medida. No es un reintento nuevo:
        // es que el diagnóstico —que ya era quirúrgico— por fin llega a quien
        // puede actuar sobre él.
        let calcRotas = [...(prepared.report.calcIssues ?? [])];
        // CSS que no puede aplicar nunca. Entra por el MISMO reintento, sin
        // presupuesto nuevo — es el defecto que ninguna otra etapa ve: el render
        // mide lo que se pinta y la puerta valida lo que está cableado, pero un
        // selector que no casa simplemente no ocurre. Medido en una página real
        // el 2026-08-23: `.timer-ring .track-ring` con la clase ausente dejó dos
        // `<circle>` de SVG con su relleno NEGRO por defecto, tapando el reloj.
        const cssMuerto = [...(prepared.report.deadRules ?? [])];
        const diagnostico = [
          ...breakage,
          ...calcRotas.map((i) => `la fórmula ${i.attr}="${i.formula}" ${i.message}`),
          ...cssMuerto.map(
            (r) =>
              `el selector \`${r.selector}\` no aplica NUNCA: falta class="${r.ausentes[0]}" en el documento`,
          ),
        ];

        // ── LA PROMESA DEL PROPIO MODELO, y por qué va APARTE ──────────────
        //
        // `diagnostico` es rotura OBSERVABLE: algo gritó, una fórmula no
        // compila, un selector no puede casar. Todo eso justifica el gasto
        // grande —una reescritura entera— porque es cierto pase lo que pase.
        //
        // Una prueba fallida NO es eso. La escribió el mismo modelo que
        // escribió el código, y PUEDE ESTAR MAL: medido el 2026-08-23, Len
        // declaró una prueba que esperaba `49:59` donde reiniciar da `50:00`.
        // Con un bucle de conversación eso da igual —se corrige en el turno
        // siguiente—; al crear dispararía una reescritura completa para nada.
        //
        // Así que vale exactamente UN intento de reparación (~234 tokens
        // medidos) y NUNCA una reescritura. Si la reparación no baja el
        // número de defectos, la página se entrega tal cual: no tenemos
        // autoridad suficiente para tirar la página del usuario por una
        // promesa que quizá esté mal escrita.
        const promesasRotas = (prepared.report.specFailures ?? []).map(
          (f) => `tu propia prueba falló — paso ${f.paso}: ${f.mensaje}`,
        );
        const paraReparar = [...diagnostico, ...promesasRotas];

        // ── REPARAR ANTES DE REESCRIBIR ────────────────────────────────────
        //
        // Primero se intenta un arreglo QUIRÚRGICO sobre la página que el
        // modelo acaba de escribir, con el mismo protocolo de ops que usan el
        // Chat y el Agente. Sólo si eso no produce nada aplicable se cae a la
        // reescritura completa, que es el comportamiento de antes.
        //
        // POR QUÉ ESTE ORDEN, con números: una reescritura cuesta una página de
        // SALIDA (~8.800 tokens medidos) y no sabe qué conservar — el mismo
        // fallo que en el rediseño del Agente se comía la foto del dueño en 8
        // de 20 turnos. Un arreglo por ops son unos cientos de tokens de salida
        // y no puede tocar lo que no nombra. Un intento fallido cuesta ~1/3 de
        // una reescritura, así que probar primero sale a cuenta incluso cuando
        // no acierta.
        //
        // Está MEDIDO que el modelo repara cuando se le enseña su propio
        // trabajo: 90% de líneas idénticas ([[model-repairs-not-recreates-measured]]).
        let repaired = false;
        if (paraReparar.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[generate] rotura medida — ${paraReparar.join(" · ")}`);
          emit("regen-starting", { reason: paraReparar.join("; ") });
          try {
            const arreglo = await repairGeneratedPage({
              html,
              runtime: runtimeCode,
              defectos: paraReparar,
              brief,
              signal: upstreamAbort.signal,
            });
            if (arreglo.ok && arreglo.html) {
              // La MISMA prueba sobre el código reparado. No se le pide otra al
              // modelo: la promesa no cambió, cambió el código que debe
              // cumplirla — y volver a preguntarla dejaría al reparador
              // ajustando el examen en vez de la respuesta.
              const tras = await engine(arreglo.html, arreglo.runtime ?? null, prueba);
              // La reparación tiene que MEJORAR para quedarse. Si deja la
              // página igual de rota —o peor— se descarta y se reescribe: un
              // arreglo que no arregla nada es una degradación silenciosa.
              const defectosTras = tras.ok
                ? [
                    ...tras.report.breakage,
                    ...(tras.report.calcIssues ?? []).map((i) => `la fórmula ${i.attr}="${i.formula}" ${i.message}`),
                    ...(tras.report.deadRules ?? []).map((r) => `el selector \`${r.selector}\` no aplica NUNCA`),
                    ...(tras.report.specFailures ?? []).map((f) => `tu propia prueba falló — paso ${f.paso}`),
                  ]
                : null;
              if (tras.ok && defectosTras !== null && defectosTras.length < paraReparar.length) {
                // eslint-disable-next-line no-console
                console.log(`[generate] reparado con ${arreglo.appliedOps} ops — ${paraReparar.length} → ${defectosTras.length} defectos`);
                html = tras.html;
                runtimeCode = arreglo.runtime ?? runtimeCode;
                prepared = tras;
                breakage = [...tras.report.breakage];
                calcRotas = [...(tras.report.calcIssues ?? [])];
                repaired = true;
                regenerated = true;
              } else {
                // eslint-disable-next-line no-console
                console.log(`[generate] reparación descartada — no bajó el número de defectos`);
              }
            } else if (!arreglo.ok) {
              // eslint-disable-next-line no-console
              console.log(`[generate] reparación sin resultado (${arreglo.reason}) — se reescribe`);
            }
          } catch (err) {
            // Nunca puede costar la página: se cae a la reescritura de siempre.
            // eslint-disable-next-line no-console
            console.warn("[generate] la reparación falló; se reescribe", err);
          }
        }

        if (diagnostico.length > 0 && !repaired) {
          const fixMessages: Message[] = [
            { role: "system", content: systemPromptFor(process.env) + modelRuntimePromptBlock(process.env) + modelPruebaPromptBlock(process.env) },
            {
              role: "user",
              // TODO el diagnóstico, no sólo `breakage`.
              //
              // Esto mandaba `breakage.map(...)` mientras la CONDICIÓN de
              // regenerar usaba `diagnostico`, que además lleva las fórmulas
              // rotas y el CSS que no aplica. O sea que una página podía
              // regenerarse POR una fórmula rota y el modelo recibía una lista
              // VACÍA: reescribía a ciegas y pagábamos la llamada igual. Un
              // diagnóstico que no llega a quien puede actuar no cierra ningún
              // bucle — es la doctrina de degradación de este repo.
              content: `<measured-breakage>
El navegador renderizó tu página anterior y midió esto:
${diagnostico.map((r) => `- ${r}`).join("\n")}

Escribe la página de nuevo sin esos defectos. No son opiniones: son medidas del render.
</measured-breakage>

${briefBlock}`,
            },
          ];
          const fixed = await runPass(fixMessages, "regen");
          if (fixed.ok) {
            const second = await engine(fixed.html, fixed.modelRuntime ?? null, fixed.modelPrueba);
            // La segunda puede salir peor que la primera: se entrega la que
            // menos rota esté, no la más reciente. Y se juzga por el TOTAL, no
            // sólo por el desborde — si arregla el render y rompe tres
            // fórmulas, salió peor.
            const antes = breakage.length + calcRotas.length;
            const despues =
              second.ok
                ? second.report.breakage.length + (second.report.calcIssues?.length ?? 0)
                : Number.POSITIVE_INFINITY;
            if (second.ok && despues <= antes) {
              prepared = second;
              html = second.html;
              runtimeCode = fixed.modelRuntime ?? null;
              regenerated = true;
              breakage = [...second.report.breakage];
              calcRotas = [...(second.report.calcIssues ?? [])];
            }
            recordRegenOutcome(true);
          } else {
            recordRegenOutcome(false);
          }
          if (breakage.length > 0) {
            // Guardar-y-avisar: la página se entrega, pero queda dicho qué
            // sigue roto. Un fallo que nadie registra vuelve a pasar.
            // eslint-disable-next-line no-console
            console.warn(`[generate] entregada con rotura — ${breakage.join(" · ")}`);
          }
        }

        // DEGRADAR SIN MENTIR. Si tras reparar y reintentar una fórmula sigue
        // muerta, se le quitan los marcadores a la región: la página queda
        // estática pero íntegra —el valor de nacimiento ya está escrito dentro
        // del elemento— y el visitante no ve un control que invite a teclear y
        // no responda.
        //
        // Es lo que hace un error boundary con un widget roto: esconderlo, no
        // mostrarlo muerto. La otra mitad —decírselo al creador— la lleva
        // `collectDegradations` con el código `broken_controls`, más abajo.
        if (calcRotas.length > 0) {
          const off = disableCalcRegions(html);
          if (off.repaired > 0) {
            html = off.html;
            // eslint-disable-next-line no-console
            console.warn(
              `[generate] cálculo apagado tras ${calcRotas.length} fórmula(s) irreparable(s) — la página se entrega sin él`,
            );
          }
        }

        // ── Vision critic loop (Quality S3) ─────────────────────────────────
        // Render the page, show Gemini Flash the screenshot, and regenerate
        // with surgical feedback if the verdict says the page is visually
        // broken. The win is variance reduction — catching the ~5% of broken
        // pages before they reach the user — not raising the average.
        //
        // Kill switch: OPENLEN_VISION_CRITIC=0 falls back to S2 one-shot
        // behavior (no critic call). Default ON. Capped at exactly ONE regen —
        // a flawed page beats a third try the user has to wait on. Born-
        // canonical normalization already ran inside each runPass (HtmlStream
        // .end()), so the chosen final — first pass or regen — is canonical;
        // nothing re-normalizes between critique and regen.
        if (process.env.OPENLEN_VISION_CRITIC !== "0" && !regenerated) {
          emit("critic-checking", {});
          const verdict = await critiqueGeneratedPage({
            brief,
            html,
            model: "gemini-3.5-flash",
            apiKey: PROVIDER.key as string,
          });
          recordCriticRun({
            shouldRegenerate: verdict.shouldRegenerate,
            fallback: verdict.fallback,
          });
          // eslint-disable-next-line no-console
          console.log(
            `[critic] regen=${verdict.shouldRegenerate ? "triggered" : "skipped"}`,
          );

          // El crítico informa; ya no gasta. Medido dos veces: puntuó la página
          // baja por las FOTOS —"Bolillo muestra un océano"— y pidió
          // regenerarla. Las fotos las coloca un emparejador determinista
          // después de escribir, con los mismos sujetos: la segunda pasada
          // recibe las mismas. Cada una de esas regeneraciones costaba una
          // página entera de tokens y un crédito del usuario (93→91→89 en dos
          // corridas) sin arreglar nada.
          //
          // El presupuesto de regeneración es de la ROTURA MEDIDA, que sí
          // cambia al reescribir. `OPENLEN_VISION_CRITIC_REGEN=1` se lo
          // devuelve.
          const criticMayRegen = process.env.OPENLEN_VISION_CRITIC_REGEN === "1";
          if (verdict.shouldRegenerate && !criticMayRegen) {
            // eslint-disable-next-line no-console
            console.log(`[critic] regen NO gastada — ${verdict.issues.join("; ").slice(0, 160)}`);
          }
          if (verdict.shouldRegenerate && criticMayRegen) {
            // Reason goes to the client only to drive a neutral "improving the
            // design…" state — never the raw critic text (bad UX to tell a
            // user their page looked bad).
            emit("regen-starting", { reason: verdict.issues.join("; ") });
            const regenBriefBlock = `<critic-feedback>\n${verdict.regenerationFeedback}\n\nIssues found in the previous attempt: ${verdict.issues.join(", ")}\n</critic-feedback>\n\n${briefBlock}`;
            const regenMessages: Message[] = [
              { role: "system", content: systemPromptFor(process.env) + modelRuntimePromptBlock(process.env) + modelPruebaPromptBlock(process.env) },
              { role: "user", content: regenBriefBlock },
            ];
            const regen = await runPass(regenMessages, "regen");
            if (regen.ok) {
              const third = await engine(regen.html, regen.modelRuntime ?? null, regen.modelPrueba);
              if (third.ok) {
                prepared = third;
                html = third.html;
                runtimeCode = regen.modelRuntime ?? null;
                regenerated = true;
              }
              recordRegenOutcome(true);
            } else {
              // Regen produced invalid HTML — ship the (already-valid) first
              // pass rather than error or wait for a third try.
              // eslint-disable-next-line no-console
              console.warn(
                `[generate] regen failed validation (${regen.message}) — shipping first pass`,
              );
              recordRegenOutcome(false);
            }
          }
        }

        // ── Guardar el documento elegido ────────────────────────────────────
        const gated = {
          removed: prepared.report.removed,
          issues: (prepared.report.behaviorIssues ?? []) as readonly never[],
        };

        // What the page lost on the way in. On the ROW, not in the SSE payload:
        // the client redirects to the workspace on `project_saved`, so a field
        // added there dies on arrival.
        //
        // In practice this is `broken_controls`. Everything else the gate
        // counts was already stripped upstream (the stream sanitizes each
        // write), so the sanitize counters here read zero — which is the
        // honest answer: the model wrote this page, not the user, and telling
        // someone their page "had JavaScript removed" about markup they never
        // typed is the noise this record exists to avoid.
        const degradations = collectDegradations({
          surface: "generate",
          removed: gated.removed,
          behaviorIssues: gated.issues,
        });

        // AI→módulos bridge: the engine already read the page's placeholders.
        const enabledModules = [...prepared.report.modules];

        let projectId: string;
        try {
          projectId = await createProject(userId, {
            html,
            brief,
            title,
            profileId: business.id,
            logoUrl: business.data.brand?.logoUrl ?? null,
            settings: enabledModules.length ? (prepared.report.moduleSettings as never) : undefined,
            degradations: degradations.length > 0 ? degradations : undefined,
            // Sin puerta de elegibilidad: formularios y módulos ya no descalifican
            // la página (ver la nota en lib/ai-stream/model-runtime.ts). Lo que
            // sigue atando el código a ESTE documento es la cápsula, y la calcula
            // createProject sobre el HTML exacto que guarda.
            modelRuntime: runtimeCode,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[generate] createProject failed", err);
          emit("error", {
            message: "Generated the page but couldn't save it — try again.",
          });
          closeStream();
          return;
        }

        // ── TU PRIMER MENSAJE ES EL TURNO 1 DE LA CONVERSACIÓN ─────────────
        //
        // Lo que escribiste para crear la página se guardaba SÓLO en la columna
        // `brief` y desaparecía: el Chat abría vacío, como si no hubieras dicho
        // nada. Y peor — el Agente lee `userBrief`, que sólo escribe la pestaña
        // Brief a mano, así que en toda página nacida de la IA no sabía lo que
        // le habías pedido. Lo deducía del HTML, que no es lo mismo.
        //
        // Se siembra como TURNO, no como `userBrief`, y la diferencia importa:
        // `userBrief` se le inyecta como «PROJECT BRIEF (persistente — aplica a
        // toda petición)», así que un «ponle una cuenta atrás» seguiría
        // mandando en el turno 40, cuando ya cambiaste de idea tres veces. Un
        // turno de conversación es historia, y la historia envejece bien.
        //
        // Fail-soft: la página ya está guardada. Perder el turno es feo; perder
        // la página por no poder escribirlo sería absurdo.
        try {
          await appendChatMessage(projectId, {
            id: randomUUID(),
            userText: brief,
            // Lo que de verdad pasó, sin adornos: el resumen que el usuario
            // relee dentro de dos semanas para acordarse de qué pidió.
            assistantReasoning: regenerated
              ? "Creé tu página y la repasé: encontré defectos al medirla en un navegador y los corregí antes de entregártela."
              : "Creé tu página.",
            status: "applied",
            page: null,
            noDocChange: false,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[generate] no se pudo sembrar el primer turno del chat", err);
        }

        // Telemetry only — the same `[name] ` + one-line-JSON convention
        // publishToDir uses. This used to be the ONLY answer this route had to
        // a control born dead: validate after the row was written and write a
        // line nobody reads. The user's answer is the `broken_controls` record
        // above, which the workspace shows as "algunos controles quedaron mal
        // conectados — pedile al asistente que los arregle". The log stays
        // because it is how we count how often the model does this; it is no
        // longer how the person who owns the page finds out.
        if (gated.issues && gated.issues.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[generate] behavior issues " +
              JSON.stringify({ projectId, issues: gated.issues }),
          );
        }

        await createVersion({
          projectId,
          html,
          label: regenerated ? `Generated (regen): ${title}` : `Generated: ${title}`,
          source: "initial",
        }).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[generate] initial version snapshot failed", err);
        });

        emit("project_saved", { projectId, title, regenerated, enabledModules });
        closeStream();
      } catch (err) {
        upstreamAbort.abort();
        // eslint-disable-next-line no-console
        console.error("[generate] stream failed", err);
        emit("error", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
        closeStream();
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(sse, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = m?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}



/** El cuerpo vive en lib/ai/sse. */
function json(body: unknown, status: number): Response {
  return jsonResponse(body, status);
}
