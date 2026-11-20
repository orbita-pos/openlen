"use client";

// A/B experiment cards in Len's chat (`new-chat-panel.tsx`):
// Renders ready-to-launch drafts and pending A/B decisions right above the composer
// (alongside `AssistantRequestCards`), ensuring owners WITHOUT Tu Asistente still get
// the exact same one-click decision experience.
import { useCallback, useEffect, useRef, useState } from "react";

import { visibleAbCards } from "@/lib/ab/cards";
import type { AbExperimentView } from "@/lib/ab/types";
import { dismissAb, readDismissedAb } from "@/lib/workspace-v2/ab-dismissed";
import { AbExperimentCard } from "../ab/ab-experiment-card";
import { AbDecisionCard } from "../ab/ab-decision-card";
import { useAbAvailable } from "../use-ab-available";

/** One look every five minutes: the evaluator's verdicts come every 30, and a person's decision refreshes the cards itself. */
export const AB_POLL_MS = 5 * 60_000;

function readAbQueryParam(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("ab");
  } catch {
    return null;
  }
}

export function AbDecisionCards({
  projectId,
  soloLectura,
  busy,
}: {
  projectId: string;
  soloLectura?: boolean;
  busy: boolean;
}) {
  const highlight = readAbQueryParam();
  // Asked once (GET /api/ab): with A/B testing off nothing below runs — no request per project, no timer.
  const available = useAbAvailable();
  const [experiments, setExperiments] = useState<readonly AbExperimentView[]>([]);
  // The harm cards this person put away (per browser).
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => setDismissed(readDismissedAb()), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ab`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        enabled?: boolean;
        experiments?: AbExperimentView[];
      };
      setExperiments(body.enabled ? (body.experiments ?? []) : []);
    } catch {
      // Soft fail; next poll retries.
    }
  }, [projectId]);

  useEffect(() => {
    if (!available) return;
    setExperiments([]);
    void load();
    const timer = setInterval(() => void load(), AB_POLL_MS);
    return () => clearInterval(timer);
  }, [available, load]);

  // Refresh after a Len turn finishes (e.g., Len just ran `create_ab_variant`).
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void load();
    wasBusy.current = busy;
  }, [busy, load]);

  if (!available) return null;

  const visible = visibleAbCards(experiments, { highlight }).filter(
    (e) => !(e.status === "paused_harm" && dismissed.has(e.id) && e.id !== highlight),
  );

  if (visible.length === 0) return null;

  return (
    <div className="mx-4 mt-3 flex shrink-0 flex-col gap-2" role="status">
      {visible.map((exp) =>
        exp.status === "draft" && !soloLectura ? (
          <AbExperimentCard key={exp.id} experiment={exp} onUpdated={() => void load()} />
        ) : (
          <AbDecisionCard
            key={exp.id}
            experiment={exp}
            readonly={soloLectura}
            highlight={highlight === exp.id}
            onUpdated={() => void load()}
            onDismiss={() => setDismissed((d) => dismissAb(exp.id, d))}
          />
        ),
      )}
    </div>
  );
}
