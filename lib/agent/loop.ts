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

export interface AgentLoopArgs {
  messages: Message[]; // system + contexto + history + user prompt (ya armados)
  tools: Record<string, unknown>[];
  /** Abre un stream de modelo para un set de mensajes. El route inyecta el
   *  GeminiProvider real; los tests inyectan streams guionados. */
  openStream(messages: Message[]): AsyncIterable<StreamEvent>;
  /** Stream con herramientas DESACTIVADAS (toolMode "none"), usado SOLO para
   *  redactar un cierre cuando se agota un tope de presupuesto — así el turno
   *  termina con un resumen útil ("hice X, faltó Y", en el idioma del usuario)
   *  en vez de un error rojo. Si se omite (o no produce texto), agotar un tope
   *  emite el error codificado como antes. El route lo enlaza al mismo provider. */
  closeOut?(messages: Message[]): AsyncIterable<StreamEvent>;
  runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  emit(ev: AgentStreamEvent): void;
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
const WRAP_UP_INSTRUCTION =
  "SISTEMA: Alcanzaste el límite de pasos para este turno y ya no puedes usar herramientas. Cierra hablándole al usuario en SU idioma: resume brevemente qué alcanzaste a hacer y qué quedó pendiente, y dile que te lo pida de nuevo para continuar. No afirmes haber hecho lo que no se aplicó.";

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

  const buildResult = (terminalError: boolean): AgentLoopResult => ({
    finalText,
    usage: { inputTokens, outputTokens, cachedTokens },
    turns,
    toolCalls,
    terminalError,
  });

  // A budget cap was hit. If a tools-disabled closeOut stream is available, let
  // the model compose a graceful closing message — emitted as normal `text`, so
  // the panel renders a normal assistant turn, NOT a red error card (chat-panel
  // shows the red card only when an `error` event arrives). Ends as a 0-credit
  // terminal either way. If closeOut is absent or yields no text, emit the coded
  // error as before so the user is never left with nothing.
  const finishOnCap = async (code: AgentErrorCode): Promise<AgentLoopResult> => {
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
        return buildResult(true);
      }
    }
    args.emit({ type: "error", message: "El agente alcanzó su límite de pasos", code });
    return buildResult(true);
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
      return { finalText, usage: { inputTokens, outputTokens, cachedTokens }, turns, toolCalls, terminalError: true };
    }

    if (calls.length === 0) {
      finalText = turnText;
      return { finalText, usage: { inputTokens, outputTokens, cachedTokens }, turns, toolCalls, terminalError: false };
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
      const sig = `${call.name} ${stableStringify(call.args)}`;
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
  }
}
