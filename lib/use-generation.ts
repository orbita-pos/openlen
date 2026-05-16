"use client";

import { useCallback, useRef, useState } from "react";
import type {
  CostBreakdown,
  FilledBlock,
  GeneratedImage,
  GenerateRequest,
  Intent,
  LandingPage,
  Plan,
  ProgressEvent,
  SseEvent,
  StepResultEvent,
} from "@/lib/orchestrator/types";
import type { GeneratingPartial, WorkspaceState } from "@/components/workspace/types";

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
  loadProject: (projectId: string) => Promise<void>;
  reset: () => void;
}

interface RegenResponse {
  page: LandingPage;
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

    setState({
      kind: "generating",
      currentStep: "classify",
      progress: [],
      partial: {
        brief: req.brief,
        filledBlocks: [],
        images: [],
        costSoFar: 0,
        startedAt: Date.now(),
      },
    });

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
        setState({
          kind: "error",
          message: `You've hit your ${scope} limit${data.max ? ` of ${data.max} generations` : ""}.${resetMsg}${planMsg}`,
        });
        return;
      }
      if (response.status === 401) {
        setState({
          kind: "error",
          message: "You need to be signed in to generate. Reload the page.",
        });
        return;
      }
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

      // The iframe overlay emits sectionId in "block-N" form (assembled by
      // lib/orchestrator/assemble.tsx). Parse it back into an integer.
      const blockIndex = parseBlockIndex(args.sectionId);
      if (blockIndex === null) {
        // eslint-disable-next-line no-console
        console.error(
          `regenerateSection: cannot parse blockIndex from sectionId="${args.sectionId}"`,
        );
        return;
      }

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
            intent: page.meta.intent,
            plan: page.plan,
            filledBlocks: page.filledBlocks,
            images: page.images,
            blockIndex,
            additionalInstruction: args.additionalInstruction,
            projectId: current.projectId,
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
          ...data.page,
          cost: addCostBreakdowns(page.cost, data.cost),
        },
        regen: undefined,
      });
    },
    [],
  );

  const loadProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ kind: "error", message: data.error ?? `Couldn't load project (${res.status})` });
        return;
      }
      const data = (await res.json()) as {
        project: { id: string; title: string; data: LandingPage };
      };
      setState({
        kind: "generated",
        result: data.project.data,
        projectId: data.project.id,
        title: data.project.title,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return { state, generate, regenerateSection, loadProject, reset };
}

function parseBlockIndex(sectionId: string): number | null {
  const m = sectionId.match(/^block-(\d+)$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
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

function addCostBreakdowns(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    total: a.total + b.total,
    classify: a.classify + b.classify,
    plan: a.plan + b.plan,
    fill: a.fill + b.fill,
    images: a.images + b.images,
    assemble: a.assemble + b.assemble,
    gates: a.gates + b.gates,
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
      const partial = prev.kind === "generating"
        ? {
            ...prev.partial,
            costSoFar: event.costSoFar ?? prev.partial.costSoFar,
          }
        : freshPartial();
      return {
        kind: "generating",
        currentStep: event.step,
        progress: prev.kind === "generating"
          ? appendProgress(prev.progress, event)
          : [event],
        partial,
      };
    });
    return;
  }
  if (event.type === "step_result") {
    setState((prev) => {
      if (prev.kind !== "generating") return prev;
      const partial = mergeStepResult(prev.partial, event);
      return { ...prev, partial };
    });
    return;
  }
  if (event.type === "error") {
    setState((prev) => {
      // Non-fatal errors (e.g. project save failed) shouldn't blow away an
      // already-generated page.
      if (prev.kind === "generated") return prev;
      return { kind: "error", message: event.message };
    });
    return;
  }
  if (event.type === "result") {
    setState(() => ({ kind: "generated", result: event.page }));
    return;
  }
  if (event.type === "project_saved") {
    setState((prev) => {
      if (prev.kind !== "generated") return prev;
      return {
        ...prev,
        projectId: event.projectId,
        title: event.title,
      };
    });
  }
}

function freshPartial(): GeneratingPartial {
  return {
    brief: "",
    filledBlocks: [],
    images: [],
    costSoFar: 0,
    startedAt: Date.now(),
  };
}

function mergeStepResult(
  partial: GeneratingPartial,
  event: StepResultEvent,
): GeneratingPartial {
  switch (event.step) {
    case "classify":
      return { ...partial, intent: event.data as Intent };
    case "plan":
      return { ...partial, plan: event.data as Plan };
    case "fill": {
      const filled = event.data as FilledBlock;
      const existing = partial.filledBlocks.findIndex(
        (b) => b.index === filled.index,
      );
      const filledBlocks =
        existing === -1
          ? [...partial.filledBlocks, filled].sort((a, b) => a.index - b.index)
          : partial.filledBlocks.map((b, i) => (i === existing ? filled : b));
      return { ...partial, filledBlocks };
    }
    case "image_hero":
    case "image_decorative": {
      const img = event.data as GeneratedImage;
      const existing = partial.images.findIndex((i) => i.id === img.id);
      const images = existing === -1
        ? [...partial.images, img]
        : partial.images.map((i, idx) => (idx === existing ? img : i));
      return { ...partial, images };
    }
    default:
      return partial;
  }
}

function appendProgress(prev: ProgressEvent[], next: ProgressEvent): ProgressEvent[] {
  const last = prev[prev.length - 1];
  if (last && last.step === next.step && last.status === next.status) return prev;
  return [...prev, next];
}
