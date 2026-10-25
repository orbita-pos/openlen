// What each tool batch did, as signals for the step rows (layer 0 of Len 3.1,
// spec local 2026-10-24-len-3-1-layers-0-1, §4.3): ok or the error code, the
// arguments only as a hash (no customer text leaves the request path), and the
// repeated-call patterns — DeepSeek's identical run (repeat-tool-reminder) plus
// the alternating pair that DeepSeek's chain misses (render → inspect → render
// in the 23/10 video turn).
import { createHash } from "node:crypto";

import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";

export interface ToolOutcomeSummary {
  readonly name: string;
  readonly argsHash: string;
  readonly ok: boolean;
  readonly errorCode?: string;
  /** El fichero de la llamada (`file_path`), sólo como hash: para ver las relecturas. */
  readonly pathHash?: string;
  /** Un Read igual a otro del turno sin escritura en ese fichero entre medias (`tengu_file_read_reread`). */
  readonly reread?: true;
}

export interface RepeatSignals {
  readonly identicalRun: number;
  readonly alternatingPair: number;
}

export function toolErrorCode(response: Record<string, unknown>): string | undefined {
  if (response.ok !== false) return undefined;
  if (typeof response.code === "string") return response.code;
  const text = String(response[CLAVE_TOOL_RESULT] ?? response.error ?? "");
  if (text.includes("have not read this file")) return "not_read";
  if (text.includes("<tool_use_error>")) return "tool_use_error";
  return "error";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) out[key] = sortKeys(record[key]);
  return out;
}

const argsHash = (args: Record<string, unknown> | undefined): string =>
  createHash("sha1").update(JSON.stringify(sortKeys(args ?? {}))).digest("hex").slice(0, 16);

export function summarizeBatch(
  calls: readonly { readonly name: string; readonly args?: Record<string, unknown> }[],
  responses: readonly { readonly name: string; readonly response: Record<string, unknown> }[],
): ToolOutcomeSummary[] {
  return calls.map((call, i) => {
    const response = responses[i]?.response ?? {};
    const errorCode = toolErrorCode(response);
    const path = call.args?.file_path;
    return {
      name: call.name,
      argsHash: argsHash(call.args),
      ok: response.ok !== false,
      ...(errorCode ? { errorCode } : {}),
      ...(typeof path === "string" ? { pathHash: createHash("sha1").update(path).digest("hex").slice(0, 16) } : {}),
    };
  });
}

export function repeatSignals(history: readonly (readonly ToolOutcomeSummary[])[]): RepeatSignals {
  const keys = history.flat().map((t) => `${t.name}:${t.argsHash}`);
  if (keys.length === 0) return { identicalRun: 0, alternatingPair: 0 };
  const last = keys[keys.length - 1]!;
  let identicalRun = 0;
  for (let i = keys.length - 1; i >= 0 && keys[i] === last; i--) identicalRun++;
  let pairs = 0;
  const before = keys[keys.length - 2];
  if (before !== undefined && before !== last) {
    for (let i = keys.length - 1; i >= 1 && keys[i] === last && keys[i - 1] === before; i -= 2) pairs++;
  }
  return { identicalRun, alternatingPair: pairs >= 2 ? pairs : 0 };
}
