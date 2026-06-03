"use client";

import { useCallback, useRef, useState } from "react";
import type { AIModel } from "@/lib/ai-provider";
import type { GenerationState } from "@/lib/use-generation";

// ─────────────────────────────────────────────────────────────────────────────
// useCuration — drives the /new AI entry flow on the CURATION path (free tier).
//
// POSTs a brief to /api/curate and consumes its SSE stream (progress / done /
// error). Unlike /api/generate, curation does NOT stream HTML — the cheap model
// picks a whole curated template + invents copy, the server fills + saves, then
// emits `done {projectId}`. We surface each stage as a `notice` so the loader
// shows live progress (and the page's "server saturated" silence-note never
// trips), then redirect to ?project=<id> on done.
//
// Returns the SAME GenerationState shape as useGeneration so the page's
// render + redirect wiring is reused verbatim — only the engine differs.
// ─────────────────────────────────────────────────────────────────────────────

export interface UseCurationResult {
  state: GenerationState;
  curate: (brief: string, model?: AIModel) => Promise<void>;
}

const SILENCE_TIMEOUT_MS = 180_000; // curation is short; only a dead connection trips this

// SSE progress stage → user-facing notice (abstract, never reveals "picking a
// template"; reads as the AI building the page).
const STAGE_TEXT: Record<string, string> = {
  picking: "Designing your page…",
  loading: "Building the layout…",
  tagging: "Preparing the page…",
  "calling-model": "Writing your copy…",
  filling: "Writing your copy…",
  applying: "Applying your content…",
  persisting: "Finishing up…",
};

export function useCuration(): UseCurationResult {
  const [state, setState] = useState<GenerationState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // `model` is accepted for drop-in parity with useGeneration's signature but
  // ignored — curation has no model picker (it always uses Flash for pick + fill).
  const curate = useCallback(async (brief: string, _model?: AIModel) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "generating", reasoning: "", html: "", notice: STAGE_TEXT.picking });

    let timedOut = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SILENCE_TIMEOUT_MS);
    };
    const clear = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = undefined;
    };
    arm();

    let response: Response;
    try {
      response = await fetch("/api/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ brief }),
        signal: controller.signal,
      });
    } catch (err) {
      clear();
      if (controller.signal.aborted) {
        if (timedOut) setState({ kind: "error", message: "La generación no respondió a tiempo — probá de nuevo." });
        return;
      }
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }

    if (!response.ok || !response.body) {
      clear();
      setState({ kind: "error", message: await errorMessage(response) });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          applyEvent(rawEvent, setState);
        }
      }
      clear();
    } catch (err) {
      clear();
      if (controller.signal.aborted) {
        if (timedOut) setState({ kind: "error", message: "La generación se quedó sin respuesta — probá de nuevo." });
        return;
      }
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  return { state, curate };
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) return "You need to be signed in. Reload the page.";
  if (response.status === 429) {
    const data = (await response.json().catch(() => ({}))) as { retryAfterSec?: number };
    return `Rate limit reached.${data.retryAfterSec ? ` Try again in ~${Math.ceil(data.retryAfterSec / 60)} min.` : ""}`;
  }
  if (response.status === 402) return "Te quedaste sin créditos este mes. Esperá al reset o pasá a Pro.";
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
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!event || dataLines.length === 0) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  } catch {
    return;
  }

  if (event === "progress") {
    const stage = typeof data.stage === "string" ? data.stage : "";
    const notice = STAGE_TEXT[stage] ?? "Working…";
    setState((prev) => (prev.kind === "generating" ? { ...prev, notice } : prev));
  } else if (event === "preview" && typeof data.html === "string") {
    const html = data.html;
    setState((prev) => (prev.kind === "generating" ? { ...prev, html } : prev));
  } else if (event === "done") {
    const projectId = typeof data.projectId === "string" ? data.projectId : "";
    const title = typeof data.title === "string" ? data.title : "Untitled page";
    if (projectId) setState(() => ({ kind: "done", projectId, title }));
  } else if (event === "error") {
    const message = typeof data.message === "string" ? data.message : "Generation failed";
    setState(() => ({ kind: "error", message }));
  }
}
