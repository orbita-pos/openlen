"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AIModel } from "@/lib/ai-provider";

// ─────────────────────────────────────────────────────────────────────────────
// useGeneration — drives the /new AI entry flow.
//
// POSTs a brief to /api/generate and consumes the Server-Sent Events stream
// (reasoning_chunk / html_chunk / critic-checking / regen-starting /
// project_saved / error). The page renders the streaming reasoning, then a
// live preview of the streaming HTML; if the S3 vision critic triggers a
// regen the preview resets and the improved version streams in. Redirects to
// ?project=<id> when `project_saved` lands.
//
// A client-side watchdog aborts if the server goes fully silent (a wedged
// route, a dead connection, no SSE at all) — the server's own stall guard
// normally errors first, this is the catch-all so the UI never hangs forever.
// ─────────────────────────────────────────────────────────────────────────────

export type GenerationState =
  | { kind: "idle" }
  | { kind: "generating"; reasoning: string; html: string; notice?: string }
  | { kind: "done"; projectId: string; title: string }
  | { kind: "error"; message: string };

export interface UseGenerationResult {
  state: GenerationState;
  generate: (
    brief: string,
    model?: AIModel,
    profileId?: string | null,
  ) => Promise<void>;
}

// No SSE byte for this long → assume the server is wedged and give up.
// The /api/generate route streams bytes throughout (html_chunk during the
// page write, or a progress ping every 5s during Gemini's initial think),
// so a healthy generation always keeps this reset. Generous enough that
// only a fully dead connection trips it.
const SILENCE_TIMEOUT_MS = 780_000;

export function useGeneration(): UseGenerationResult {
  const [state, setState] = useState<GenerationState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream on unmount so a generation the user walked away
  // from stops server-side (saves Gemini credits / metered usage).
  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = useCallback(async (brief: string, model: AIModel = "gemini-flash", profileId: string | null = null) => {
    // Cancel any in-flight generation before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "generating", reasoning: "", html: "" });

    // Watchdog — reset on every byte from the server. Only fires on real
    // silence (no response at all, or the stream went dead).
    let timedOut = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SILENCE_TIMEOUT_MS);
    };
    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = undefined;
    };

    armWatchdog();

    let response: Response;
    try {
      response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ brief, model, profileId }),
        signal: controller.signal,
      });
    } catch (err) {
      clearWatchdog();
      if (controller.signal.aborted) {
        if (timedOut) {
          setState({
            kind: "error",
            message:
              "La generación no respondió a tiempo — probá de nuevo.",
          });
        }
        return;
      }
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!response.ok || !response.body) {
      clearWatchdog();
      setState({ kind: "error", message: await errorMessage(response) });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armWatchdog(); // bytes flowing — reset the silence clock
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          applyEvent(rawEvent, setState);
        }
      }
      clearWatchdog();
    } catch (err) {
      clearWatchdog();
      if (controller.signal.aborted) {
        if (timedOut) {
          setState({
            kind: "error",
            message:
              "La generación se quedó sin respuesta — probá de nuevo.",
          });
        }
        return;
      }
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return { state, generate };
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) {
    return "You need to be signed in to generate. Reload the page.";
  }
  if (response.status === 403) {
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    return (
      data.message ??
      "From-scratch generation is a Pro feature. Upgrade to Pro, or use the Quick (curated) flow."
    );
  }
  if (response.status === 429) {
    const data = (await response.json().catch(() => ({}))) as {
      scope?: string;
      plan?: string;
      max?: number;
      resetAt?: string;
    };
    const scope = data.scope ?? "quota";
    const resetMsg = data.resetAt
      ? ` Resets ${formatRelativeReset(data.resetAt)}.`
      : "";
    const planMsg = data.plan === "free" ? " Upgrade to Pro for more." : "";
    return `You've hit your ${scope} limit${
      data.max ? ` of ${data.max} generations` : ""
    }.${resetMsg}${planMsg}`;
  }
  const text = await response.text().catch(() => response.statusText);
  return text || `Request failed (${response.status})`;
}

function applyEvent(
  rawEvent: string,
  setState: (updater: (prev: GenerationState) => GenerationState) => void,
) {
  let event = "";
  const dataLines: string[] = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (!event || dataLines.length === 0) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  } catch {
    return;
  }

  if (event === "reasoning_chunk" && typeof data.text === "string") {
    const text = data.text;
    setState((prev) =>
      prev.kind === "generating"
        ? { ...prev, reasoning: prev.reasoning + text }
        : prev,
    );
  } else if (event === "html_chunk" && typeof data.text === "string") {
    const text = data.text;
    setState((prev) =>
      prev.kind === "generating" ? { ...prev, html: prev.html + text } : prev,
    );
  } else if (event === "critic-checking") {
    // S3 vision critic is rendering + scoring the page. Abstract progress
    // text only — never surface that "the AI is checking if it looks bad".
    setState((prev) =>
      prev.kind === "generating"
        ? { ...prev, notice: "Checking visual quality…" }
        : prev,
    );
  } else if (event === "regen-starting") {
    // The critic asked for a regen. Reset the preview buffer so the better
    // version streams in fresh (replacing the discarded first pass — Phase
    // 3.3). The `reason` payload is intentionally NOT shown: keep it abstract
    // (Phase 3.2) so we never tell the user their page looked broken.
    setState((prev) =>
      prev.kind === "generating"
        ? { ...prev, html: "", notice: "Improving the design…" }
        : prev,
    );
  } else if (event === "project_saved") {
    const projectId = typeof data.projectId === "string" ? data.projectId : "";
    const title =
      typeof data.title === "string" ? data.title : "Untitled page";
    if (projectId) setState(() => ({ kind: "done", projectId, title }));
  } else if (event === "error") {
    const message =
      typeof data.message === "string" ? data.message : "Generation failed";
    setState(() => ({ kind: "error", message }));
  }
}

function formatRelativeReset(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "in a moment";
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.round(h / 24);
  return `in ${d}d`;
}
