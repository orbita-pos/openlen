"use client";

import { useCallback, useRef, useState } from "react";
import type {
  Copy,
  CostBreakdown,
  GenerateRequest,
  ProgressEvent,
  SseEvent,
} from "@/lib/orchestrator/types";
import type { WorkspaceState } from "@/components/workspace/types";

export interface RegenSectionArgs {
  sectionId: string;
  sectionName: string;
  additionalInstruction?: string;
  mode: "regen" | "edit";
}

export interface UseGenerationResult {
  state: WorkspaceState;
  generate: (req: GenerateRequest) => Promise<void>;
  regenerateSection: (args: RegenSectionArgs) => Promise<void>;
  reset: () => void;
}

interface RegenResponse {
  html: string;
  css: string;
  copy: Copy;
  cost: CostBreakdown;
  generationId: string;
}

export function useGeneration(): UseGenerationResult {
  const [state, setState] = useState<WorkspaceState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const currentRef = useRef<WorkspaceState>(state);
  currentRef.current = state;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const generate = useCallback(async (req: GenerateRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ kind: "generating", currentStep: "classify", progress: [] });

    let response: Response;
    try {
      response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => response.statusText);
      setState({ kind: "error", message: text || `Request failed (${response.status})` });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const event = parseSseChunk(rawEvent);
          if (!event) continue;
          applyEvent(event, setState);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const regenerateSection = useCallback(
    async (args: RegenSectionArgs) => {
      const current = currentRef.current;
      if (current.kind !== "generated") return;
      const page = current.result;

      setState({
        kind: "generated",
        result: page,
        regen: {
          sectionId: args.sectionId,
          sectionName: args.sectionName,
          mode: args.mode,
        },
      });

      let response: Response;
      try {
        response = await fetch("/api/regenerate-section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brief: page.meta.brief,
            plan: page.plan,
            copy: page.copy,
            images: page.images,
            sectionId: args.sectionId,
            additionalInstruction: args.additionalInstruction,
          }),
        });
      } catch (err) {
        setState({
          kind: "generated",
          result: page,
          regen: undefined,
        });
        // eslint-disable-next-line no-console
        console.error("regenerate-section fetch failed:", err);
        return;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        setState({ kind: "generated", result: page, regen: undefined });
        // eslint-disable-next-line no-console
        console.error("regenerate-section failed:", text);
        return;
      }

      const data = (await response.json()) as RegenResponse;
      setState({
        kind: "generated",
        result: {
          ...page,
          html: data.html,
          css: data.css,
          copy: data.copy,
          cost: addCostBreakdowns(page.cost, data.cost),
        },
        regen: undefined,
      });
    },
    [],
  );

  return { state, generate, regenerateSection, reset };
}

function addCostBreakdowns(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    total: a.total + b.total,
    classify: a.classify + b.classify,
    plan: a.plan + b.plan,
    copy: a.copy + b.copy,
    html: a.html + b.html,
    images: a.images + b.images,
    refine: a.refine + b.refine,
  };
}

function parseSseChunk(chunk: string): SseEvent | null {
  const dataLines = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  const json = dataLines.join("\n");
  try {
    return JSON.parse(json) as SseEvent;
  } catch {
    return null;
  }
}

function applyEvent(
  event: SseEvent,
  setState: (updater: (prev: WorkspaceState) => WorkspaceState) => void,
) {
  if (event.type === "progress") {
    setState((prev) => {
      if (prev.kind !== "generating") {
        return { kind: "generating", currentStep: event.step, progress: [event] };
      }
      return {
        kind: "generating",
        currentStep: event.step,
        progress: appendProgress(prev.progress, event),
      };
    });
    return;
  }
  if (event.type === "error") {
    setState(() => ({ kind: "error", message: event.message }));
    return;
  }
  if (event.type === "result") {
    setState(() => ({ kind: "generated", result: event.page }));
  }
}

function appendProgress(prev: ProgressEvent[], next: ProgressEvent): ProgressEvent[] {
  const last = prev[prev.length - 1];
  if (last && last.step === next.step && last.status === next.status) return prev;
  return [...prev, next];
}
