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
// payload against the same contract the panel switches on.
export type AgentErrorCode =
  | "turn_limit"
  | "tool_limit"
  | "cancelled"
  | "truncated"
  | "upstream"
  | "no_credits";

export type AgentStreamEvent =
  | { type: "text"; text: string }
  | { type: "action"; tool: string; status: "running" | "done" | "error"; summary: string }
  | { type: "html"; html: string }
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
  runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  emit(ev: AgentStreamEvent): void;
  maxTurns?: number; // default 6
  maxToolCalls?: number; // default 10
}

export interface AgentLoopResult {
  finalText: string;
  usage: { inputTokens: number; outputTokens: number };
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
  let turns = 0;
  let toolCalls = 0;

  while (true) {
    if (turns >= maxTurns) {
      args.emit({ type: "error", message: "El agente alcanzó su límite de pasos", code: "turn_limit" });
      return { finalText, usage: { inputTokens, outputTokens }, turns, toolCalls, terminalError: true };
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
      return { finalText, usage: { inputTokens, outputTokens }, turns, toolCalls, terminalError: true };
    }

    if (calls.length === 0) {
      finalText = turnText;
      return { finalText, usage: { inputTokens, outputTokens }, turns, toolCalls, terminalError: false };
    }

    const functionResponses: { name: string; response: Record<string, unknown> }[] = [];
    for (const call of calls) {
      if (toolCalls >= maxToolCalls) {
        args.emit({ type: "error", message: "El agente alcanzó su límite de pasos", code: "tool_limit" });
        return { finalText, usage: { inputTokens, outputTokens }, turns, toolCalls, terminalError: true };
      }
      toolCalls += 1;

      const summary = typeof call.args.resumen === "string" ? call.args.resumen : call.name;
      args.emit({ type: "action", tool: call.name, status: "running", summary });

      const outcome = await args.runTool(call.name, call.args);
      const ok = outcome.response.ok !== false;
      args.emit({
        type: "action",
        tool: call.name,
        status: ok ? "done" : "error",
        summary: outcome.action?.summary ?? summary,
      });

      if (outcome.updatedHtml) {
        args.emit({ type: "html", html: outcome.updatedHtml });
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
