// lib/agent/loop.ts — provider-agnostic agentic loop (F1 Task 8).
//
// Pure orchestration: no network, no DB, no native bindings. Both
// `openStream` (real GeminiProvider in the route) and `runTool` (Task 7's
// runAgentTool) are injected, which is what makes this unit-testable with
// scripted async iterables and zero I/O.
//
// IMPORTANT: only `import type` from @/lib/ai-gateway and @/lib/agent/tools.
// A runtime (value) import of either would transitively load the native
// @openlen/ai-gateway / @/lib/html-engine .node bindings, which vite/vitest
// cannot load — see loop.test.ts's header comment for the same constraint.
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { ToolOutcome } from "@/lib/agent/tools";

// F2 Task 10: a coded error lets the panel show a localized message instead
// of the raw Spanish `message` (which stays as the server-side/fallback
// string — never removed, just no longer the only source of truth). Only
// `no_credits` is never emitted from this file (route.ts's credit gate owns
// it) — it lives in the shared union so the route can type its own error
// payload against the same contract the panel switches on. F4 Task 7:
// `agent_off` is the same story — the route's OPENLEN_AGENT=0 kill-switch
// emits it before this loop ever runs. Unlike the others it's never shown
// to the user: the panel intercepts it and falls back to classic ai-design
// silently, so it has no `wsPage.agent.errors.agent_off` translation.
/** Los dos códigos que significan «se acabó la cuerda», no «se rompió algo».
 *  Subconjunto de AgentErrorCode a propósito: `AgentLoopResult.topeAlcanzado`
 *  no puede llevar `upstream` ni `cancelled`, que sí son fallos. */
export type TopeCode = Extract<AgentErrorCode, "turn_limit" | "tool_limit">;

export type AgentErrorCode =
  | "turn_limit"
  | "tool_limit"
  | "cancelled"
  | "truncated"
  | "upstream"
  | "no_credits"
  | "agent_off";

export type AgentStreamEvent =
  | { type: "text"; text: string }
  | { type: "action"; tool: string; status: "running" | "done" | "error"; summary: string }
  // F4 Task 4 — the ONLY SSE protocol change this task makes: `html` gains
  // `page` (the slot this document belongs to — null for home). Needed
  // because `trabajar_en_pagina` can move the active document mid-turn, so a
  // later `html` event in the same turn may target a different page than the
  // one the turn started on; the panel paints whichever slot `page` names,
  // never assuming it's still the page the canvas is showing.
  | { type: "html"; html: string; page: string | null }
  // The publish gate (Task 7): the model prepared a publish but MUST NOT
  // publish itself. The panel renders a confirm card whose button hits the
  // real publish endpoint — the user's tap is the only thing that publishes.
  | { type: "confirm"; action: "publicar"; subdominio: string; idiomas: string[]; republicar: boolean }
  | { type: "done"; turns: number; toolCalls: number }
  | { type: "error"; message: string; code?: AgentErrorCode };

/**
 * Resultado del hook de verificación visual (F5 — "los ojos"). TRES variantes,
 * y la tercera es la que faltaba.
 *
 * 🔴 «NO PUDE MIRAR» NO ES «ESTÁ BIEN». Los ojos fallan ABIERTOS por diseño
 * —Chrome caído, sin key, timeout, JSON malformado devuelven un veredicto
 * benigno con `fallback: true`— y eso está bien: una verificación que no
 * arranca no puede tumbar el turno del usuario. Lo que estaba mal es que la
 * ruta convertía ese fallback en `ok: true`, así que dentro del producto no
 * quedaba NADA que distinguiera «miré y está bien» de «no pude mirar». Con
 * Chromium caído en el box, la verificación aprobaba todo en silencio y sólo el
 * diario lo sabía.
 *
 * `no_mirado` no dispara ciclo de arreglo —no hay nada que arreglar, no hay
 * crítica— pero SÍ se ve: la tarjeta lo dice, en vez de enseñar el visto bueno
 * de una comprobación que no ocurrió.
 */
export type VerifyOutcome =
  | { estado: "bien" }
  | {
      /** Los problemas encontrados, ya redactados para inyectarse en el mensaje
       *  de crítica (una línea por problema). */
      estado: "roto";
      critique: string;
    }
  | { estado: "no_mirado"; motivo: string };

// El nombre de "herramienta" bajo el que la verificación visual aparece en el
// panel (una action card normal — el panel la localiza via agent.tool.*).
export const VERIFY_TOOL = "verificar_diseno";

export interface AgentLoopArgs {
  messages: Message[]; // system + contexto + history + user prompt (ya armados)
  tools: Record<string, unknown>[];
  /** Abre un stream de modelo para un set de mensajes. El route inyecta el
   *  GeminiProvider real; los tests inyectan streams guionados. */
  openStream(messages: Message[]): AsyncIterable<StreamEvent>;
  /** F5 — los ojos del agente. Cuando está presente y el turno MUTÓ el
   *  documento, se llama UNA vez justo antes de cerrar (con el último HTML
   *  emitido); si devuelve !ok, la crítica se inyecta como mensaje de sistema
   *  y el modelo recibe UN ciclo de arreglo dentro de los mismos topes. Debe
   *  ser fail-open: cualquier throw se trata como ok. */
  verifyTurn?(info: { html: string; page: string | null }): Promise<VerifyOutcome>;
  /** Stream con herramientas DESACTIVADAS (toolMode "none"), usado SOLO para
   *  redactar un cierre cuando se agota un tope de presupuesto — así el turno
   *  termina con un resumen útil ("hice X, faltó Y", en el idioma del usuario)
   *  en vez de un error rojo. Si se omite (o no produce texto), agotar un tope
   *  emite el error codificado como antes. El route lo enlaza al mismo provider. */
  closeOut?(messages: Message[]): AsyncIterable<StreamEvent>;
  runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  emit(ev: AgentStreamEvent): void;
  /** Se llama UNA vez, en cuanto una herramienta escribe en la base. El route
   *  lo usa para saber que el turno ya mutó incluso si el bucle revienta
   *  después y nunca llega a devolver un resultado. */
  onMutacion?(): void;
  maxTurns?: number; // default 6
  maxToolCalls?: number; // default 10
}

export interface AgentLoopResult {
  finalText: string;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  turns: number;
  toolCalls: number;
  /** F2-T9 billing ruling: true when the turn ended via stopReason error/
   *  cancelled/max_tokens, or the maxTurns/maxToolCalls caps — the route
   *  debits 0 credits in that case. False for a clean end_turn finish,
   *  INCLUDING a turn where a tool returned {ok:false} as data (the turn
   *  still completed) and a turn that ended waiting on a confirm card. */
  terminalError: boolean;
  /** CUÁL de los dos finales fue, porque `terminalError` los confunde.
   *
   *  `terminalError` es true tanto si el turno REVENTÓ (503, cancelado,
   *  max_tokens) como si AGOTÓ UN TOPE — y son cosas distintas: lo primero es
   *  un fallo, lo segundo es el agente quedándose sin cuerda a media faena.
   *  Peor aún, el caso del tope suele ser el MENOS visible: cuando `closeOut`
   *  redacta el cierre elegante no se emite ningún evento `error`, así que
   *  quien mire los eventos ve un turno que terminó mal y ni siquiera un
   *  código que lo explique.
   *
   *  MEDIDO el 2026-08-30 en la batería del Agente: tres de los ocho fallos
   *  decían «terminó en error terminal» y nada más. Distinguirlos aquí es lo
   *  que convierte «falló» en «se quedó sin pasos», que es un arreglo
   *  distinto. Null = no fue un tope. */
  topeAlcanzado: TopeCode | null;
  /** Alguna herramienta ESCRIBIÓ en la base durante este request.
   *
   *  Va junto a `terminalError` a propósito: la combinación de los dos es el
   *  caso que hacía daño. Un turno que guardó y luego se cortó (503, cancelado,
   *  max_tokens) se pintaba ROJO, no se persistía en la transcripción y no
   *  dejaba Undo — mientras el cambio vivía ya en la base. El usuario pulsaba
   *  «Reintentar» y aplicaba el mismo cambio DOS veces. */
  mutoDurable: boolean;
}

/** Lo que queda en el historial en lugar del documento retirado. Dice POR QUÉ
 *  se fue y qué hacer, porque un hueco sin explicación invita al modelo a
 *  inventarse los ids que ya no ve. */
export const DOCUMENTO_PODADO =
  "[documento retirado del historial: sus data-op-id ya no son válidos porque hubo ediciones después. Si necesitas editar, pide leer_estado con incluir_documento=true para obtener el documento fresco.]";

/**
 * PODA LOS DOCUMENTOS VIEJOS DEL HISTORIAL — deja SÓLO el último.
 *
 * El bucle reenvía todo lo acumulado en cada vuelta, y `editar_pagina` NO
 * devuelve el documento: el modelo tiene que volver a pedirlo con
 * `leer_estado incluir_documento=true`. La propia instrucción de corrección
 * visual se lo ordena. Así que un turno que edita y luego recibe crítica lleva
 * DOS documentos completos en contexto, y en una página mediana eso son ~22k
 * tokens cada uno.
 *
 * El viejo no es sólo caro, es ENGAÑOSO: tras una edición los data-op-id
 * cambian —lo dice la ficha de la propia herramienta— así que el documento
 * anterior describe un mapa que ya no existe. Retirarlo sale más barato Y más
 * correcto.
 *
 * Medido el 2026-08-28 sobre las páginas reales: el prefijo fijo (prompt de
 * sistema + herramientas) son 13.036 tokens que se repiten en cada vuelta; el
 * documento va de 17k a 308k. El documento es lo que domina, y duplicarlo es
 * lo único de todo esto que no compra nada.
 *
 * Pura a propósito: muta los objetos que recibe y no devuelve nada, igual que
 * el resto del bucle, pero no toca red ni estado — se puede comprobar sola.
 */
export function podarDocumentosViejos(messages: Message[]): number {
  let visto = false;
  let podados = 0;
  // De atrás hacia delante: el PRIMERO que encuentra es el vigente y se queda.
  for (let i = messages.length - 1; i >= 0; i--) {
    const respuestas = messages[i].functionResponses;
    if (!respuestas) continue;
    for (let j = respuestas.length - 1; j >= 0; j--) {
      const r = respuestas[j].response;
      if (typeof r.documento !== "string") continue;
      if (!visto) {
        visto = true;
        continue;
      }
      r.documento = DOCUMENTO_PODADO;
      podados += 1;
    }
  }
  return podados;
}

const DEFAULT_MAX_TURNS = 6;
const DEFAULT_MAX_TOOL_CALLS = 10;

// No-progress guard: the SAME tool call (name + identical args) that has already
// returned ok:false this many times is refused the next time instead of run
// again — the model gets a nudge to change approach rather than looping on a
// dead action (e.g. retrying editar_pagina against a stale op-id). Only FAILING
// repeats are guarded; a call that succeeds is never blocked.
const FAIL_REPEAT_LIMIT = 2;

// Injected as a final user turn when a cap is hit and a closeOut stream exists —
// asks the (tools-disabled) model to close gracefully in the user's language.
// Lo que se le dice cuando cierra el turno sin haber llamado a ninguna
// herramienta y sin haber tocado nada. Mismo contenido que el aviso de
// `turnoAnteriorMudo` en context.ts —que es el que ya se sabe que funciona—
// pero entregado DENTRO del turno en vez de en el siguiente.
const INSISTE_SIN_HERRAMIENTAS =
  "SISTEMA (el usuario NO escribió esto): cerraste el turno SIN llamar a ninguna herramienta, así que la página NO ha cambiado. Si tu respuesta anunciaba un cambio —«agrego», «hago», «listo»— ese cambio NO existe: aplícalo AHORA con la herramienta que corresponda, y no vuelvas a decir que lo hiciste hasta haberla llamado. Si en cambio tu respuesta era una explicación, una pregunta o una negativa honesta, estaba bien: repítela tal cual y cierra.";

const WRAP_UP_INSTRUCTION =
  "SISTEMA: Alcanzaste el límite de pasos para este turno y ya no puedes usar herramientas. Cierra hablándole al usuario en SU idioma: resume brevemente qué alcanzaste a hacer y qué quedó pendiente, y dile que te lo pida de nuevo para continuar. No afirmes haber hecho lo que no se aplicó.";

// F5 — el mensaje que abre el ciclo de arreglo cuando la verificación visual
// encontró rotura. Deja claro que (a) no lo escribió el usuario, (b) los ids
// viejos ya no sirven, y (c) negar el problema no es una opción.
function buildVisualFixInstruction(critique: string): string {
  return `SISTEMA (verificación visual automática — el usuario NO escribió esto): Se tomó una captura de la página después de tus cambios y un revisor visual encontró rotura objetiva:\n${critique}\n\nCorrígela AHORA: llama leer_estado con incluir_documento=true para obtener el documento con data-op-id frescos y aplica los arreglos con editar_pagina. Si un problema no lo causaron tus cambios o no puedes arreglarlo con tus herramientas, dilo con honestidad en tu cierre — no lo niegues ni afirmes que quedó arreglado sin arreglarlo.`;
}

/** Order-stable JSON of a tool call's args, so a repeat with the same values
 *  keys identically regardless of property order (the no-progress guard's key). */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

// Product finding: photo hunts (elegir_foto) and mid-chain state re-reads
// (leer_estado) are read-only — they never mutate the project — but a photo
// search that takes a few tries was eating the same maxToolCalls budget as
// real edits. These two are exempt from that counter. They still count
// toward ABSOLUTE_MAX_TOOL_CALLS below, so a runaway loop can't spin forever
// just because it's calling exempt tools.
const READ_ONLY_TOOLS = new Set(["leer_estado", "elegir_foto"]);
// Hard safety net independent of maxToolCalls: counts every tool call,
// exempt or not. A model stuck in a loop must still die eventually.
const ABSOLUTE_MAX_TOOL_CALLS = 20;

interface PendingCall {
  name: string;
  args: Record<string, unknown>;
  /** Gemini 3 thought signature, echoed verbatim into the replayed
   *  assistant turn's `functionCalls` entry — see lib/ai-gateway.ts's
   *  `FunctionCall.thoughtSignature` doc comment. */
  thoughtSignature?: string;
}

export async function runAgentLoop(args: AgentLoopArgs): Promise<AgentLoopResult> {
  const maxTurns = args.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxToolCalls = args.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  const messages = [...args.messages];
  let finalText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let turns = 0;
  // Only turns that MUTATE count toward maxTurns. A turn whose calls were all
  // read-only (elegir_foto photo hunts, leer_estado re-reads) is exempt —
  // otherwise the turn cap silently defeats the same read-only exemption
  // maxToolCalls already grants (READ_ONLY_TOOLS), and a photo hunt for a genre
  // the curated catalog lacks dies on turn_limit before the model ever edits
  // (the terror-hero bug). ABSOLUTE_MAX_TOOL_CALLS still bounds a read-only
  // chain so it can't spin forever.
  let mutatingTurns = 0;
  let toolCalls = 0; // total across the loop (read-only + budgeted) — what the result/done event reports
  let budgetedToolCalls = 0; // excludes READ_ONLY_TOOLS — checked against maxToolCalls
  // No-progress guard state (spans turns within this request): signature -> how
  // many times that exact call has returned ok:false.
  const failedSignatures = new Map<string, number>();
  // F5 — verificación visual: el último documento emitido por un tool este
  // request (lo que el usuario está viendo en el canvas) y si el ciclo de
  // verificación ya corrió (corre a lo sumo UNA vez por request — un segundo
  // ciclo podría oscilar entre dos arreglos y quemar presupuesto sin fin).
  let lastMutation: { html: string; page: string | null } | null = null;
  let verifiedOnce = false;
  // ¿Ya se le insistió una vez por cerrar sin llamar a nada? Ver el bloque de
  // `calls.length === 0`.
  let yaSeInsistio = false;

  /** ¿Escribió algo en la base este request? Ver `AgentLoopResult.mutoDurable`. */
  let mutoDurable = false;

  const buildResult = (
    terminalError: boolean,
    topeAlcanzado: TopeCode | null = null,
  ): AgentLoopResult => ({
    finalText,
    usage: { inputTokens, outputTokens, cachedTokens },
    turns,
    toolCalls,
    terminalError,
    topeAlcanzado,
    mutoDurable,
  });

  // A budget cap was hit. If a tools-disabled closeOut stream is available, let
  // the model compose a graceful closing message — emitted as normal `text`, so
  // the panel renders a normal assistant turn, NOT a red error card (chat-panel
  // shows the red card only when an `error` event arrives). Ends as a 0-credit
  // terminal either way. If closeOut is absent or yields no text, emit the coded
  // error as before so the user is never left with nothing.
  // `TopeCode` y no `AgentErrorCode`: sus dos únicos llamadores pasan
  // turn_limit/tool_limit, y estrecharlo aquí es lo que deja que el código
  // viaje al resultado sin un cast.
  const finishOnCap = async (code: TopeCode): Promise<AgentLoopResult> => {
    if (args.closeOut) {
      let wrapText = "";
      for await (const ev of args.closeOut([
        ...messages,
        { role: "user", content: WRAP_UP_INSTRUCTION },
      ])) {
        if (ev.type === "text_delta") {
          wrapText += ev.text;
          args.emit({ type: "text", text: ev.text });
        } else if (ev.type === "usage") {
          inputTokens += ev.inputTokens;
          outputTokens += ev.outputTokens;
          cachedTokens += ev.cachedTokens;
        }
        // function_call / done ignored — tools are off on this stream.
      }
      if (wrapText.trim().length > 0) {
        finalText = wrapText;
        return buildResult(true, code);
      }
    }
    args.emit({ type: "error", message: "El agente alcanzó su límite de pasos", code });
    return buildResult(true, code);
  };

  while (true) {
    if (mutatingTurns >= maxTurns) {
      return await finishOnCap("turn_limit");
    }
    turns += 1;

    let turnText = "";
    const calls: PendingCall[] = [];
    let sawError = false;

    for await (const ev of args.openStream(messages)) {
      if (ev.type === "text_delta") {
        turnText += ev.text;
        args.emit({ type: "text", text: ev.text });
      } else if (ev.type === "function_call") {
        calls.push({
          name: ev.name,
          args: ev.args,
          ...(ev.thoughtSignature ? { thoughtSignature: ev.thoughtSignature } : {}),
        });
      } else if (ev.type === "usage") {
        inputTokens += ev.inputTokens;
        outputTokens += ev.outputTokens;
        cachedTokens += ev.cachedTokens;
      } else if (ev.type === "done") {
        // A stream that ends on anything but a clean end_turn must NOT read
        // as success: error (SAFETY/RECITATION/5xx), cancelled (abort), and
        // max_tokens (truncated response) all surface as an error event and
        // stop the loop — a truncated turn's partial text is not a real answer.
        if (ev.stopReason.kind === "error") {
          args.emit({ type: "error", message: ev.stopReason.error, code: "upstream" });
          sawError = true;
        } else if (ev.stopReason.kind === "cancelled") {
          args.emit({ type: "error", message: "El agente fue cancelado.", code: "cancelled" });
          sawError = true;
        } else if (ev.stopReason.kind === "max_tokens") {
          args.emit({
            type: "error",
            message: "El agente se quedó sin espacio de respuesta — intenta un pedido más corto.",
            code: "truncated",
          });
          sawError = true;
        }
      }
    }

    if (sawError) {
      // `buildResult`, no un objeto a mano: esta rama era una copia literal del
      // constructor y por eso se quedó sin `mutoDurable` al añadirlo — que es
      // justo la rama donde más falta hace.
      return buildResult(true);
    }

    if (calls.length === 0) {
      // 🔴 ANUNCIÓ LA EDICIÓN Y NO LA HIZO. Se le pide UNA vez, aquí mismo.
      //
      // MEDIDO en producción el 2026-08-31, dos veces en tres minutos: a
      // «agregame en el menu un link para ir a la page de nosotros» el modelo
      // contestó «¡Claro! Agrego un enlace "Nosotros"… El nav está en
      // data-op-id="9"… Listo, agregué el enlace» —con el id CORRECTO— y no
      // llamó a nada. 203 tokens de salida: sólo la prosa. El usuario vio
      // «Listo» junto a «Nothing on the page changed», tuvo que escribir «no
      // agregaste el nosotros», y el reintento funcionó a la primera.
      //
      // El aviso que lo arregla YA EXISTE (`turnoAnteriorMudo`, en
      // context.ts): dice «tu turno anterior NO llamó a ninguna herramienta…
      // aplícalo AHORA». Lo único que le faltaba era llegar a tiempo — sólo se
      // monta en el turno SIGUIENTE, o sea después de que el usuario se queje.
      //
      // POR QUÉ ES BARATO, que es lo que lo hace viable: esta segunda vuelta
      // reusa el prefijo entero (sistema + herramientas + contexto + el mensaje
      // del usuario), así que es un acierto de caché. Medido sobre los turnos
      // reales: ~40k de entrada casi toda cacheada ≈ 0,4 créditos, contra los
      // ~4 que costó el turno fantasma y los ~30 del reintento que el usuario
      // acabó pagando al quejarse.
      //
      // UNA sola vez por petición, y sólo si NADA se tocó: un turno que ya mutó
      // y cierra está bien cerrado, y una pregunta legítima («¿qué modelo
      // uso?») se contesta igual en la segunda vuelta — el modelo repite su
      // respuesta y se acabó. No se intenta adivinar si el texto «promete» algo:
      // eso sería una heurística sobre prosa en diez idiomas.
      // `toolCalls === 0` —ninguna llamada en TODO el request—, no
      // `!mutoDurable`: son cosas distintas y la diferencia la cazó una prueba
      // que ya existía. Un turno que llamó a una herramienta ACTUÓ, aunque esa
      // herramienta no marque mutación durable (activar_modulo, publicar…);
      // empujarlo sería pagar una vuelta de más por un turno que hizo su
      // trabajo. Lo que se corrige es cerrar sin haber llamado a NADA.
      if (toolCalls === 0 && !yaSeInsistio && turnText.trim().length > 0) {
        yaSeInsistio = true;
        messages.push({ role: "assistant", content: turnText });
        messages.push({ role: "user", content: INSISTE_SIN_HERRAMIENTAS });
        continue;
      }

      // F5 — los ojos: el modelo quiere cerrar y este request mutó el
      // documento. Antes de dejarlo ir, UNA verificación visual — solo si
      // queda presupuesto para un ciclo de arreglo real (un turno mutante +
      // al menos una llamada presupuestada); sin presupuesto, verificar sería
      // encontrar un problema que ya no se puede arreglar.
      if (
        args.verifyTurn &&
        lastMutation &&
        !verifiedOnce &&
        mutatingTurns < maxTurns &&
        budgetedToolCalls < maxToolCalls &&
        toolCalls < ABSOLUTE_MAX_TOOL_CALLS
      ) {
        verifiedOnce = true;
        args.emit({ type: "action", tool: VERIFY_TOOL, status: "running", summary: "" });
        let verdict: VerifyOutcome;
        try {
          verdict = await args.verifyTurn(lastMutation);
        } catch (e) {
          // Fail-open: los ojos jamás rompen un turno. Pero el turno sigue
          // sabiendo que NADIE MIRÓ — antes esto devolvía `ok: true` y el visto
          // bueno era indistinguible de una verificación de verdad.
          verdict = {
            estado: "no_mirado",
            motivo: e instanceof Error ? e.message : "la verificación lanzó",
          };
        }
        if (verdict.estado === "roto") {
          args.emit({ type: "action", tool: VERIFY_TOOL, status: "done", summary: "issues" });
          messages.push({ role: "assistant", content: turnText });
          messages.push({ role: "user", content: buildVisualFixInstruction(verdict.critique) });
          continue; // un ciclo de arreglo, dentro de los mismos topes
        }
        // `no_mirado` NO dispara ciclo de arreglo: no hay crítica que dar y
        // cobrarle al usuario una vuelta por una comprobación que no ocurrió
        // sería peor que no comprobar. Pero se DICE.
        args.emit({
          type: "action",
          tool: VERIFY_TOOL,
          status: "done",
          summary: verdict.estado === "no_mirado" ? "no-mirado" : "ok",
        });
      }
      finalText = turnText;
      // Igual que la rama de error: por el constructor, no a mano.
      return buildResult(false);
    }

    // A turn counts toward maxTurns only if it did something other than
    // read-only lookups — a hunt/read-only-only turn is "free" (see mutatingTurns).
    if (calls.some((c) => !READ_ONLY_TOOLS.has(c.name))) {
      mutatingTurns += 1;
    }

    const functionResponses: { name: string; response: Record<string, unknown> }[] = [];
    for (const call of calls) {
      // No-progress guard: this exact call already failed FAIL_REPEAT_LIMIT
      // times — don't run it again. Feed the model a nudge (as a functionResponse
      // so the FC protocol stays balanced) to change approach. A refused call
      // doesn't run, so it doesn't touch the caps; termination is still
      // guaranteed because a mutating turn advances maxTurns → finishOnCap.
      const sig = `${call.name}\u0000${stableStringify(call.args)}`;
      if ((failedSignatures.get(sig) ?? 0) >= FAIL_REPEAT_LIMIT) {
        functionResponses.push({
          name: call.name,
          response: {
            ok: false,
            error:
              "Ya intentaste esta misma acción con los mismos parámetros y falló varias veces. NO la repitas: cambia de enfoque (otra herramienta o parámetros distintos), o dile al usuario qué pudiste hacer y qué no.",
          },
        });
        continue;
      }

      // The absolute cap counts every call, exempt or not — a runaway loop
      // must still die even if it's only calling read-only tools.
      if (toolCalls >= ABSOLUTE_MAX_TOOL_CALLS) {
        return await finishOnCap("tool_limit");
      }
      const readOnly = READ_ONLY_TOOLS.has(call.name);
      if (!readOnly) {
        if (budgetedToolCalls >= maxToolCalls) {
          return await finishOnCap("tool_limit");
        }
        budgetedToolCalls += 1;
      }
      toolCalls += 1;

      const summary = typeof call.args.resumen === "string" ? call.args.resumen : call.name;
      args.emit({ type: "action", tool: call.name, status: "running", summary });

      const outcome = await args.runTool(call.name, call.args);
      const ok = outcome.response.ok !== false;
      if (!ok) failedSignatures.set(sig, (failedSignatures.get(sig) ?? 0) + 1);
      args.emit({
        type: "action",
        tool: call.name,
        status: ok ? "done" : "error",
        summary: outcome.action?.summary ?? summary,
      });

      if (outcome.updatedHtml) {
        args.emit({ type: "html", html: outcome.updatedHtml, page: outcome.page ?? null });
        lastMutation = { html: outcome.updatedHtml, page: outcome.page ?? null };
      }
      // Lo durable incluye los cambios de AJUSTES, que no emiten html: módulos,
      // tema, motion, música, 3D, datos vivos. `runAgentTool` los cuenta.
      if (!mutoDurable && (outcome.mutoDurable || outcome.updatedHtml)) {
        mutoDurable = true;
        args.onMutacion?.();
      }

      // A confirm outcome (publicar) NEVER carries out its action. Surface the
      // confirm card to the user and hand the model a fixed "waiting" state so
      // it closes the turn asking for the tap — never a payload it could read
      // as "already published".
      if (outcome.confirm) {
        args.emit({ type: "confirm", ...outcome.confirm });
        functionResponses.push({
          name: call.name,
          response: {
            ok: true,
            estado: "esperando_confirmacion_del_usuario",
            subdominio: outcome.confirm.subdominio,
          },
        });
        continue;
      }

      functionResponses.push({ name: call.name, response: outcome.response });
    }

    messages.push({ role: "assistant", content: turnText, functionCalls: calls });
    messages.push({ role: "user", content: "", functionResponses });
    // Con el documento nuevo ya en el historial, los anteriores sobran: sus
    // data-op-id murieron en cuanto se aplicó una edición. Se poda DESPUÉS de
    // empujar, para que el vigente sea siempre el que acaba de entrar.
    podarDocumentosViejos(messages);
  }
}
