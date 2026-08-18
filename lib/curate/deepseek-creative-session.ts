import type {
  FireworksToolCall,
  FireworksToolClient,
  FireworksToolMessage,
  FireworksToolTurnResult,
} from "@/lib/ai/fireworks-tool-client";
import type { SafeCreativeCandidate } from "./creative-baseline";
import type { CreativeSandbox } from "./creative-sandbox";
import { parseCreativePatch, type CreativeToolFailureCode, type CreativeToolResult } from "./creative-sandbox-contracts";
import { ACCEPTED_MUTATION_CEILING, SESSION_TURN_CEILING, effortProfile } from "./page-effort";

// Los valores de `low`, que son con los que se midieron las páginas buenas.
// Quien llama puede pedir más, hasta el techo que la tabla de niveles fija;
// nadie puede pedir menos de uno ni más de lo que un nivel compra.
const DEFAULT_MAX_TURNS = effortProfile("low").sessionTurns;
const DEFAULT_MAX_ACCEPTED_MUTATIONS = effortProfile("low").acceptedMutations;
// Measured on a real page, not estimated: the design turn -- the one that
// rewrites sections -- spent 31,396 output tokens and finished. 12,000 died
// reasoning; 24,000 truncated mid-patch and burned a turn on the retry. The
// ceiling is reserved, not spent, so headroom costs nothing unused.
const DEFAULT_MAX_OUTPUT_TOKENS = 48_000;
const TRUNCATED_MAX_OUTPUT_TOKENS = 64_000;

export interface CreativeSessionInput {
  readonly requestId: string;
  readonly baseline: SafeCreativeCandidate;
  readonly brief: string;
  readonly maxTurns?: number;
  readonly maxAcceptedMutations?: number;
  readonly maxOutputTokens?: number;
  readonly issueSummary?: string;
}

export interface CreativeSessionDeps {
  readonly client: FireworksToolClient;
  readonly sandbox: CreativeSandbox;
  readonly requestImage?: (input: { targetId: string; subject: string; mediaType?: string }) => Promise<CreativeToolResult>;
  readonly recordModel?: (stage: "creative_session", result: FireworksToolTurnResult) => void;
}

/** The transport's own verdict, kept intact. Collapsing timeout, a thrown
 * connection and a malformed call into one word costs a paid run to undo. */
type ClientFailure = Exclude<Extract<FireworksToolTurnResult, { ok: false }>["code"], "budget_exceeded">;

export interface CreativeSessionResult {
  readonly candidate: SafeCreativeCandidate;
  readonly changed: boolean;
  readonly acceptedMutations: number;
  readonly stoppedBy: "finished" | "budget" | "tool_limit" | "turn_limit" | ClientFailure;
  /** Distinct tool refusals the model ran into, in the order it met them, as
   * `code` or `code:detail`. A session that designed nothing and one whose
   * every patch was refused are the same empty result without this. */
  readonly rejections: readonly string[];
}

function systemPrompt(): string {
  return [
    "You are OpenLen's page designer. You improve a real landing page through tools.",
    "The canvas comes with the brief, so spend your first turn changing the page, not looking at it.",
    "Make the page unmistakably belong to its niche:",
    "structure, rhythm, colour, typography, texture and motion are all yours through HTML and CSS.",
    // La jerarquía se mide en móvil, y era el defecto más común de las páginas
    // medidas. DESIGN_GUIDANCE no llega hasta aquí a propósito: son ~10.8k
    // tokens contra los ~330 de este prompt, en cada turno de la sesión.
    "Mobile decides the hierarchy: your h1 is judged at 390px wide, after your responsive classes shrink it -- keep it at text-4xl or larger there, hero body copy at text-base to text-lg, and the headline at least twice the body size. A 24px headline over a 20px paragraph is a tie, not a hierarchy.",
    "A section you replace loses the stylesheet it had: send that section's css in the same operation as its html, or your markup lands with class names nothing styles.",
    "Avoid the generic centred hero-badge-title-paragraph-two-buttons stack unless the brief truly calls for it.",
    "You may not use scripts, event handlers or executable URLs; reach for CSS or an OpenLen module instead.",
    "Backgrounds and textures come from CSS gradients, data: URIs or the request_image tool: a url() pointing at any other host is refused and costs you the whole patch.",
    "Some niches live on real photography -- food, lodging, travel, physical products, people -- and for those ask request_image and OpenLen resolves and places the photo for you. Where the niche is illustrative, CSS you write yourself will beat any photograph.",
    "Stop by replying with no tool call once the page is genuinely better.",
  ].join(" ");
}

/** Tool results travel back to the model as bounded observations. Page HTML and
 * URLs never do: the model already knows what it sent, and telemetry must not
 * carry page bytes. */
function redactToolResult(result: CreativeToolResult | Record<string, unknown>): string {
  if ("ok" in result && result.ok === false) {
    return JSON.stringify({ ok: false, code: (result as { code: string }).code, detail: (result as { detail?: string }).detail ?? null });
  }
  if ("outline" in result) {
    const inspection = result as unknown as { outline: { targetId: string; role: string; tag: string; textPreview: string }[]; imageSlots: unknown[]; pageCssBytes: number };
    return JSON.stringify({
      outline: inspection.outline.map((entry) => ({ targetId: entry.targetId, role: entry.role, tag: entry.tag, textPreview: entry.textPreview.slice(0, 120) })),
      imageSlots: inspection.imageSlots,
      pageCssBytes: inspection.pageCssBytes,
    });
  }
  return JSON.stringify({ ok: true, warnings: (result as { warnings?: string[] }).warnings ?? [] });
}

/** Keeps the refusal bounded by construction: a detail is a slug from one of
 * the guards or it does not travel. Nothing from the page can ride along. */
function refusal(result: { code: CreativeToolFailureCode; detail?: string }): string {
  return result.detail && /^[a-z][a-z0-9_]{0,39}$/.test(result.detail)
    ? `${result.code}:${result.detail}`
    : result.code;
}

function acceptedOperations(call: FireworksToolCall): number {
  const parsed = parseCreativePatch(call.arguments);
  return parsed.ok ? parsed.patch.operations.length : 0;
}

async function dispatch(
  call: FireworksToolCall,
  deps: CreativeSessionDeps,
): Promise<{ result: CreativeToolResult | Record<string, unknown>; accepted: number }> {
  if (call.name === "inspect_canvas") return { result: deps.sandbox.inspect() as unknown as Record<string, unknown>, accepted: 0 };
  if (call.name === "render_preview") return { result: await deps.sandbox.renderPreview(), accepted: 0 };
  if (call.name === "request_image") {
    if (!deps.requestImage) return { result: { ok: false, code: "invalid_patch", detail: "image_tool_unavailable" } as CreativeToolResult, accepted: 0 };
    const args = call.arguments as { targetId?: string; subject?: string; mediaType?: string };
    if (typeof args?.targetId !== "string" || typeof args?.subject !== "string") {
      return { result: { ok: false, code: "invalid_patch", detail: "invalid_arguments" } as CreativeToolResult, accepted: 0 };
    }
    return { result: await deps.requestImage({ targetId: args.targetId, subject: args.subject, ...(args.mediaType ? { mediaType: args.mediaType } : {}) }), accepted: 0 };
  }
  const result = await deps.sandbox.applyPatch(call.arguments);
  return { result, accepted: result.ok ? acceptedOperations(call) : 0 };
}

export async function runDeepSeekCreativeSession(
  input: CreativeSessionInput,
  deps: CreativeSessionDeps,
): Promise<CreativeSessionResult> {
  const maxTurns = Math.max(1, Math.min(input.maxTurns ?? DEFAULT_MAX_TURNS, SESSION_TURN_CEILING));
  const maxAcceptedMutations = Math.max(
    1,
    Math.min(input.maxAcceptedMutations ?? DEFAULT_MAX_ACCEPTED_MUTATIONS, ACCEPTED_MUTATION_CEILING),
  );
  const messages: FireworksToolMessage[] = [
    { role: "system", content: systemPrompt() },
    {
      role: "user",
      content: [
        input.issueSummary
          ? `Brief: ${input.brief}\n\nA reviewer flagged: ${input.issueSummary}\nFix it in one pass.`
          : `Brief: ${input.brief}\n\nMake this page belong to its niche.`,
        // The handles a patch needs were only obtainable through a tool call,
        // so every session paid at least one turn to learn them -- and a
        // session that pays four never designs. Niche-independent by
        // construction: no brief needs its own instructions for this.
        `Canvas: ${redactToolResult(deps.sandbox.inspect() as unknown as Record<string, unknown>)}`,
        `You have ${maxTurns} tool turn(s). Changing the page is what they are for.`,
      ].join("\n\n"),
    },
  ];

  let acceptedMutations = 0;
  const rejections = new Set<string>();
  const finish = (stoppedBy: CreativeSessionResult["stoppedBy"]): CreativeSessionResult => ({
    candidate: deps.sandbox.current(),
    changed: acceptedMutations > 0,
    acceptedMutations,
    stoppedBy,
    rejections: [...rejections],
  });

  // Explicit and finite: no recursion, no automatic retry, no way to spend more
  // paid turns than the chosen level bought. Provider and tool failures are
  // observations here —
  // the page already exists and is safe.
  let maxOutputTokens = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  for (let turn = 0; turn < maxTurns && acceptedMutations < maxAcceptedMutations; turn += 1) {
    const response = await deps.client.turn({
      requestId: `${input.requestId}.creative-${turn}`,
      maxOutputTokens,
      messages,
    });
    // Recorded before the outcome check: a turn that failed still reserved and
    // settled budget, and its category is the only trace of why the session
    // stopped. Skipping it makes a paid failure invisible in the journal.
    deps.recordModel?.("creative_session", response);
    if (!response.ok) {
      if (response.code === "budget_exceeded") return finish("budget");
      // The ceiling ended this turn, not the model. Raising it once and
      // spending the next turn on the same request is the difference between a
      // designed page and the baseline; a second truncation is a real failure.
      if (response.providerCategory === "response_truncated" && maxOutputTokens < TRUNCATED_MAX_OUTPUT_TOKENS) {
        maxOutputTokens = TRUNCATED_MAX_OUTPUT_TOKENS;
        continue;
      }
      return finish(response.code);
    }
    if (response.calls.length === 0) return finish("finished");

    messages.push({
      role: "assistant",
      content: response.content ?? "",
      ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
      toolCalls: response.calls.map((call) => ({ id: call.id, name: call.name, argumentsJson: JSON.stringify(call.arguments) })),
    });

    for (const call of response.calls) {
      const { result, accepted } = await dispatch(call, deps);
      acceptedMutations += accepted;
      if ("ok" in result && result.ok === false) rejections.add(refusal(result as { code: CreativeToolFailureCode; detail?: string }));
      messages.push({ role: "tool", toolCallId: call.id, content: redactToolResult(result) });
      if (acceptedMutations >= maxAcceptedMutations) return finish("tool_limit");
    }
  }
  return finish("turn_limit");
}
