"use client";

// A/B experiment cards in Len's chat (`new-chat-panel.tsx`):
// Renders ready-to-launch drafts and pending A/B decisions right above the composer
// (alongside `AssistantRequestCards`), ensuring owners WITHOUT Tu Asistente still get
// the exact same one-click decision experience.
import { useCallback, useEffect, useRef, useState } from "react";

import type { AbExperimentView } from "@/lib/ab/types";
import { AbExperimentCard } from "../ab/ab-experiment-card";
import { AbDecisionCard } from "../ab/ab-decision-card";

const POLL_MS = 60_000;

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
  const [enabled, setEnabled] = useState(false);
  const [experiments, setExperiments] = useState<readonly AbExperimentView[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ab`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        enabled?: boolean;
        experiments?: AbExperimentView[];
      };
      setEnabled(Boolean(body.enabled));
      setExperiments(body.experiments ?? []);
    } catch {
      // Soft fail; next poll retries.
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Refresh after a Len turn finishes (e.g., Len just ran `create_ab_variant`).
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void load();
    wasBusy.current = busy;
  }, [busy, load]);

  if (!enabled) return null;

  const visible = experiments.filter(
    (e) =>
      e.status === "draft" ||
      ((e.status === "winner_ready" || e.status === "inconclusive") &&
        e.decisionStatus === "pending") ||
      e.bringState === "conflict" ||
      (highlight !== null && e.id === highlight),
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
          />
        ),
      )}
    </div>
  );
}
