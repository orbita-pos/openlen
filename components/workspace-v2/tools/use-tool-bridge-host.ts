"use client";

// THE WORKSPACE SIDE OF A TOOL'S BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4). The tool runs in a
// frame on its own `.app` host with no credentials; it asks here. This side answers only its own frame from its
// own origin; relays what needs the server with the person's session; never writes production until the person
// accepts OpenLen's dialog (option B); puts text in Len's composer and never sends it; and gives the tool the
// workspace's colours, light or dark, and tells it when they change — what DeepSeek feared an iframe would lose.
import { useEffect, useMemo, useRef, type RefObject } from "react";

import {
  BRIDGE_CHANNEL,
  isBridgeRequest,
  TOOL_THEME_TOKENS,
  type BridgeError,
  type BridgeRequest,
  type DataChange,
  type ToolContext,
} from "@/lib/tools/bridge/protocol";

export type BridgeHostCaller = { readonly installationId: string } | { readonly draftProjectId: string };
export type ToolChange = DataChange & { readonly projectId: string };

export interface BridgeHostOptions {
  frame(): Window | null;
  frameOrigin: string | null;
  caller: BridgeHostCaller;
  context(): Omit<ToolContext, "theme">;
  theme(): ToolContext["theme"];
  /** Null where there is no chat to write in (a rail tool): `sendPrompt` answers `unavailable`. */
  onPrompt: ((text: string) => void) | null;
  /** OpenLen's dialog: true only when the person pressed «Aplicar». */
  onConfirmChange(change: ToolChange): Promise<boolean>;
  fetchImpl?: typeof fetch;
  timeZone?: string;
  locale?: string;
}

const PROMPT_MAX = 2000;
const INTERNAL_ERROR = -32603;

/** The workspace's colours and mode, read where the workspace paints them. */
export function readToolTheme(): ToolContext["theme"] {
  const mode = document.documentElement.classList.contains("dark") ? "dark" : "light";
  const el = document.querySelector(".workspace-v2") ?? document.documentElement;
  const style = getComputedStyle(el);
  const tokens: Record<string, string> = {};
  for (const name of TOOL_THEME_TOKENS) {
    const v = style.getPropertyValue(name).trim();
    if (v) tokens[name] = v;
  }
  return { mode, tokens };
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function createToolBridgeHost(o: BridgeHostOptions): { onMessage(e: MessageEvent): Promise<void>; notifyContext(): void } {
  const doFetch = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const post = (message: unknown) => {
    const frame = o.frame();
    if (frame && o.frameOrigin) frame.postMessage(message, o.frameOrigin);
  };
  const answer = (id: number, r: { result: unknown } | { error: BridgeError }) => post({ jsonrpc: "2.0", id, ...r, channel: BRIDGE_CHANNEL });
  const relay = async (url: string, body: Record<string, unknown>): Promise<{ result: unknown } | { error: BridgeError }> => {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...o.caller, timeZone: o.timeZone, locale: o.locale, ...body }),
      });
      const data = record(await res.json().catch(() => ({})));
      if (!res.ok) return { error: { code: res.status, message: typeof data.error === "string" ? data.error : "bridge_failed" } };
      return { result: data };
    } catch {
      return { error: { code: INTERNAL_ERROR, message: "bridge_failed" } };
    }
  };

  async function handle(req: BridgeRequest): Promise<{ result: unknown } | { error: BridgeError }> {
    const p = record(req.params);
    switch (req.method) {
      case "context":
        return { result: { ...o.context(), theme: o.theme() } };
      case "sendPrompt": {
        if (!o.onPrompt) return { result: { status: "unavailable" } };
        const text = String(p.text ?? "").trim().slice(0, PROMPT_MAX);
        if (!text) return { result: { status: "unavailable" } };
        o.onPrompt(text);
        return { result: { status: "placed" } };
      }
      case "update": {
        const change = { projectId: String(p.projectId ?? ""), table: String(p.table ?? ""), key: record(p.key), set: record(p.set), before: record(p.before) };
        if (!(await o.onConfirmChange(change))) return { result: { status: "declined" } };
        return relay("/api/tools/data-change", { change });
      }
      default: {
        const r = await relay("/api/tools/bridge", { request: req });
        if ("error" in r) return r;
        const rpc = record(r.result);
        return rpc.error ? { error: rpc.error as BridgeError } : { result: rpc.result };
      }
    }
  }

  return {
    async onMessage(e: MessageEvent) {
      const frame = o.frame();
      if (!frame || e.source !== frame || !o.frameOrigin || e.origin !== o.frameOrigin) return;
      if (!isBridgeRequest(e.data)) return;
      answer(e.data.id, await handle(e.data));
    },
    notifyContext() {
      post({ jsonrpc: "2.0", method: "context", params: { ...o.context(), theme: o.theme() }, channel: BRIDGE_CHANNEL });
    },
  };
}

export function useToolBridgeHost(o: {
  iframe: RefObject<HTMLIFrameElement | null>;
  frameOrigin: string | null;
  caller: BridgeHostCaller;
  context: Omit<ToolContext, "theme">;
  onPrompt: ((text: string) => void) | null;
  onConfirmChange(change: ToolChange): Promise<boolean>;
}): void {
  const latest = useRef(o);
  latest.current = o;
  const host = useMemo(
    () =>
      createToolBridgeHost({
        frame: () => latest.current.iframe.current?.contentWindow ?? null,
        frameOrigin: o.frameOrigin,
        caller: o.caller,
        context: () => latest.current.context,
        theme: readToolTheme,
        onPrompt: o.onPrompt ? (text) => latest.current.onPrompt?.(text) : null,
        onConfirmChange: (change) => latest.current.onConfirmChange(change),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: o.context.person.locale,
      }),
    // The caller and the frame's origin decide who answers; the rest is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o.frameOrigin, JSON.stringify(o.caller), o.onPrompt === null],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => void host.onMessage(e);
    window.addEventListener("message", onMessage);
    const observer = new MutationObserver(() => host.notifyContext());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [host]);
}
