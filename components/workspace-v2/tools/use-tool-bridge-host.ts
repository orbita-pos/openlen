"use client";

// THE WORKSPACE SIDE OF A TOOL'S BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4). The tool runs in a
// frame on its own `.app` host with no credentials; it asks here. This side answers only its own frame from its
// own origin; relays what needs the server with the person's session; never writes production until the person
// accepts OpenLen's dialog (option B); puts text in Len's composer and never sends it; and gives the tool the
// workspace's colours, light or dark, and tells it when they change — what DeepSeek feared an iframe would lose.
// Phase 3 (§4.6): a job runs only after OpenLen's confirmation, with the numbers of the version's declaration; a file
// reaches a job only through OpenLen's own picker, here in the workspace — the frame never names a file of the disk.
import { useEffect, useMemo, useRef, type RefObject } from "react";

import { createToolBridgeHost, type BridgeHostCaller, type ToolChange } from "@/lib/tools/bridge/host";
import { TOOL_THEME_TOKENS, type ToolContext, type ToolJobAsk } from "@/lib/tools/bridge/protocol";
import type { ToolJobView } from "@/lib/tools/jobs/types";

// The bridge host itself lives in lib/tools/bridge/host.ts since phase 5: the phone app answers a tool with it too.
export { createToolBridgeHost, type BridgeHostCaller, type BridgeHostOptions, type ToolChange } from "@/lib/tools/bridge/host";

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

export function useToolBridgeHost(o: {
  iframe: RefObject<HTMLIFrameElement | null>;
  frameOrigin: string | null;
  caller: BridgeHostCaller;
  context: Omit<ToolContext, "theme">;
  onPrompt: ((text: string) => void) | null;
  onConfirmChange(change: ToolChange): Promise<boolean>;
  onConfirmJob(job: ToolJobAsk): Promise<boolean>;
  onPickFiles(o: { accept?: string; multiple: boolean }): Promise<File[] | null>;
  onJobStarted?(job: ToolJobView): void;
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
        onConfirmJob: (job) => latest.current.onConfirmJob(job),
        onPickFiles: (pick) => latest.current.onPickFiles(pick),
        onJobStarted: (job) => latest.current.onJobStarted?.(job),
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
