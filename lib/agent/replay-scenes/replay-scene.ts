// Replays real production turns through the loop (layer 1 of Len 3.1, spec
// local 2026-10-24-len-3-1-layers-0-1, §5.2), like DeepSeek's recorded session
// snapshots: the model is a script that says again what Len said in that row,
// the tools answer what they answered, and the requests are built the way the
// route builds them (`assembleTurnMessages`, `historialDesdeLaBase`). What is
// checked is not the model but the harness: each request of a turn must extend
// the previous one, and the next turn must start with the last request of this
// one, rebuilt from the saved row — the provider's cache depends on both.
//
// The rows already went through production jsonb; what this replay saves goes
// through `jsonbRoundTrip`. The scripted model writes each call's arguments in
// REVERSE key order, so an order the model might use that jsonb would not keep
// is exercised on every call with two or more keys.
import type { InlineImage, Message, StreamEvent } from "@/lib/ai-gateway";
import { assembleTurnMessages, turnRequestText } from "@/lib/agent/context";
import { runAgentLoop } from "@/lib/agent/loop";
import { comparePrefix, jsonbRoundTrip, type ReplayCheck } from "@/lib/agent/testing/replay-invariant";
import {
  historialDesdeLaBase,
  transcripcionParaGuardar,
  type FilaDelHistorial,
  type TranscripcionGuardada,
} from "@/lib/agent/transcripcion";
import { photosOf, type ChatPhoto } from "@/lib/projects/chat-photos";
import type { SceneFile, SceneRow } from "./scene-files";

export interface SceneTurnCheck {
  readonly rowId: string;
  readonly withinTurn: ReplayCheck;
  /** `null` for the first replayed turn. */
  readonly acrossTurns: ReplayCheck | null;
}

export interface SceneReplay {
  readonly checks: readonly SceneTurnCheck[];
  /** Every request each replayed turn sent, in order. */
  readonly requests: ReadonlyMap<string, readonly Message[][]>;
}

const SYSTEM = "[system prompt of the replay]";
const MANUAL = "[platform manual of the replay]";
const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const usage: StreamEvent = { type: "usage", inputTokens: 1, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 };

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).reverse()) out[key] = reversedKeys(record[key]);
  return out;
}

/** What Len said in the row, one stream per assistant message. */
function scriptOf(mensajes: readonly Message[]): StreamEvent[][] {
  return mensajes
    .filter((m) => m.role === "assistant")
    .map((m) => [
      ...(m.reasoning ? [{ type: "reasoning" as const, text: m.reasoning }] : []),
      ...(m.content ? [{ type: "text_delta" as const, text: m.content }] : []),
      ...(m.functionCalls ?? []).map((c) => ({ type: "function_call" as const, name: c.name, args: reversedKeys(c.args ?? {}) as Record<string, unknown> })),
      usage,
      done,
    ]);
}

/** Stand-in pixels for a photo: the same address gives the same bytes in every request. */
const pixelsOf = (url: string): InlineImage => ({ mimeType: "image/png", dataBase64: Buffer.from(url, "utf8").toString("base64") });

const fila = (r: SceneRow): FilaDelHistorial => ({
  userText: r.userText,
  assistantReasoning: r.assistantReasoning,
  transcript: r.transcript,
  attachedImage: (r.attachedImage as ChatPhoto | ChatPhoto[] | null) ?? null,
});

function isExtension(requests: readonly Message[][]): ReplayCheck {
  for (let i = 1; i < requests.length; i++) {
    const check = comparePrefix(requests[i - 1]!, requests[i]!);
    if (!check.ok) return check;
  }
  return { ok: true };
}

export async function replayScene(scene: SceneFile, replayIds: readonly string[]): Promise<SceneReplay> {
  const rows: SceneRow[] = [...scene.rows];
  const start = rows.findIndex((r) => r.id === replayIds[0]);
  const end = rows.findIndex((r) => r.id === replayIds.at(-1));
  if (start < 0 || end < start) throw new Error(`scene ${scene.name}: rows to replay not found`);

  const checks: SceneTurnCheck[] = [];
  const requests = new Map<string, Message[][]>();
  let previous: { last: Message[] } | null = null;

  for (let i = start; i <= end; i++) {
    const row = rows[i]!;
    // A11: the whole conversation the file holds, as the route loads it now.
    const historyRows = rows.slice(0, i);
    const photos = [...historyRows, row].flatMap((r) => photosOf(r.attachedImage as ChatPhoto | ChatPhoto[] | null).map((p) => p.url));
    const history = historialDesdeLaBase(historyRows.map(fila), undefined, new Map(photos.map((url) => [url, pixelsOf(url)])));

    // The request as the route builds it (`argsDelTurno.prompt` + avisos, the
    // photos on the last message). The context, the memory and the notices are
    // the exact ones the row saved.
    const t: TranscripcionGuardada | null = row.transcript;
    // Rows from before 12/10 did not save their context; today's route does.
    const contextBlock = t?.contexto ?? "[context of the replay]";
    const initial = assembleTurnMessages({
      systemPrompt: SYSTEM,
      manual: MANUAL,
      history,
      memoryMessage: t?.memoria ?? null,
      contextBlock,
      prompt: turnRequestText({
        prompt: row.userText,
        avisos: t?.avisos ?? "",
        // Seen in the turn: the replay gives every photo its pixels.
        attachedImages: photosOf(row.attachedImage as ChatPhoto | ChatPhoto[] | null).map((p) => ({ ...p, visible: true })),
      }),
    });
    const ownPhotos = photosOf(row.attachedImage as ChatPhoto | ChatPhoto[] | null).map((p) => pixelsOf(p.url));
    if (ownPhotos.length > 0) initial[initial.length - 1] = { ...initial[initial.length - 1]!, images: ownPhotos };

    const recorded = t?.mensajes ?? [];
    const script = scriptOf(recorded);
    const answers = recorded.flatMap((m) => m.functionResponses ?? []).map((r) => ({ ...r, used: false }));
    const sent: Message[][] = [];
    let step = 0;
    const result = await runAgentLoop({
      messages: initial,
      tools: [],
      openStream: (messages) => {
        sent.push(structuredClone(messages));
        const turn = script[step++] ?? [usage, done];
        return (async function* () {
          for (const ev of turn) yield ev;
        })();
      },
      runTool: async (name) => {
        const answer = answers.find((a) => !a.used && a.name === name);
        if (!answer) return { response: { ok: false, error: "[no recorded answer in the scene]" } };
        answer.used = true;
        return { response: answer.response };
      },
      emit: () => {},
    });
    requests.set(row.id, sent);

    const acrossTurns =
      previous === null || sent.length === 0 ? null : comparePrefix(previous.last, sent[0]!);
    checks.push({ rowId: row.id, withinTurn: isExtension(sent), acrossTurns });

    // Saved the way today's route saves it (with the context it sent), then
    // through jsonb, back on the row.
    if (t && result.transcripcion) {
      const saved = jsonbRoundTrip(transcripcionParaGuardar(result.transcripcion, new Map()));
      rows[i] = { ...row, transcript: { ...t, mensajes: saved.mensajes, contexto: contextBlock } };
    }
    previous = sent.length > 0 ? { last: sent.at(-1)! } : null;
  }
  return { checks, requests };
}
