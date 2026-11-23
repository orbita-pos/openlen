// Phone API calls for an agent's own tools (spec local 2026-11-22-herramienta-dentro-del-agente, §2, §4):
// list the agent's tools (`GET /api/agent-tools?assistantId=`), open one on the phone's OWN private label
// (`POST /api/movil/agent-tools/[id]/open` — never the list's workspace `frameUrl`), stream live changes with a
// fetch reader + `crearLectorSse` (`GET /api/agent-tools/[id]/follow`), and delete (`DELETE /api/agent-tools/[id]`).
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { crearLectorSse } from "@/lib/len-bench/sse";
import type { DataChangedParams } from "@/lib/tools/bridge/protocol";

export interface AgentToolItem {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

/** Lists an agent's tools. Returns `null` on transport or 5xx errors so callers keep existing state instead of wiping it. */
export async function listAgentTools(c: ClienteDeOpenLen, assistantId: string, signal?: AbortSignal): Promise<AgentToolItem[] | null> {
  const res = await c.pedir(`/api/agent-tools?assistantId=${encodeURIComponent(assistantId)}`, signal ? { signal } : undefined).catch(() => null);
  if (!res) return null;
  if (res.status === 404) return [];
  if (!res.ok) return null;
  const raw = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(raw)) return null;
  const out: AgentToolItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.slug === "string" && typeof o.title === "string") {
      // Deliberately drop the workspace `frameUrl` / `frameOrigin`: the phone opens on its own label via `openAgentTool`.
      out.push({ id: o.id, slug: o.slug, title: o.title });
    }
  }
  return out;
}

export async function openAgentTool(c: ClienteDeOpenLen, id: string): Promise<{ url: string; origin: string } | { error: string }> {
  const res = await c.pedir(`/api/movil/agent-tools/${encodeURIComponent(id)}/open`, { method: "POST" }).catch(() => null);
  if (!res) return { error: "network" };
  if (res.status === 401) return { error: "unauthorized" };
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok && typeof body?.url === "string" && typeof body.origin === "string") return { url: body.url, origin: body.origin };
  if (res.status === 404) return { error: "not_found" };
  return { error: typeof body?.error === "string" ? body.error : String(res.status) };
}

/** Removes the tool. `unauthorized`: the key is no longer good — the client is already signing the person out
 *  (`alNoAutorizado`), so it is no failure to show, as `followAgentTool` says it too. A 404 is a tool already gone. */
export async function deleteAgentTool(c: ClienteDeOpenLen, id: string): Promise<"removed" | "failed" | "unauthorized"> {
  const res = await c.pedir(`/api/agent-tools/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  if (!res) return "failed";
  if (res.status === 401) return "unauthorized";
  return res.ok || res.status === 404 ? "removed" : "failed";
}

function isDataChanged(raw: unknown): raw is DataChangedParams {
  if (!raw || typeof raw !== "object") return false;
  const kind = (raw as { kind?: unknown }).kind;
  return kind === "baseline" || kind === "change";
}

export type FollowResult = "gone" | "ended" | "aborted" | "unauthorized";

/** Follows one tool's SSE stream over `cliente.pedir` (carries the phone's bearer key) until `event: gone`,
 *  abort, 401, or EOF/error. Any non-`gone` end tells the caller to reconnect for a fresh baseline. */
export async function followAgentTool(
  c: ClienteDeOpenLen,
  id: string,
  o: {
    signal: AbortSignal;
    onData: (params: DataChangedParams) => void;
    onGone: () => void;
    onUnauthorized?: () => void;
  },
): Promise<FollowResult> {
  if (o.signal.aborted) return "aborted";
  let res: Response;
  try {
    res = await c.pedir(`/api/agent-tools/${encodeURIComponent(id)}/follow`, {
      signal: o.signal,
      headers: { accept: "text/event-stream" },
    });
  } catch {
    return o.signal.aborted ? "aborted" : "ended";
  }
  if (o.signal.aborted) return "aborted";
  if (res.status === 401) {
    o.onUnauthorized?.();
    return "unauthorized";
  }
  if (res.status === 404) {
    o.onGone();
    return "gone";
  }
  if (!res.ok || !res.body) return "ended";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const lector = crearLectorSse();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  o.signal.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (o.signal.aborted) return "aborted";
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (chunk) {
        for (const ev of lector.empujar(chunk)) {
          if (o.signal.aborted) return "aborted";
          if (ev.nombre === "gone") {
            void reader.cancel().catch(() => {});
            o.onGone();
            return "gone";
          }
          if ((ev.nombre === "baseline" || ev.nombre === "change") && isDataChanged(ev.datos)) {
            o.onData(ev.datos);
          }
        }
      }
      if (done) return "ended";
    }
  } catch {
    return o.signal.aborted ? "aborted" : "ended";
  } finally {
    o.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
