"use client";

// ¿TE SIRVIÓ? — los votos de cada turno en el chat nuevo (plans/new-chat/). Se
// leen una vez al montar y se pintan OPTIMISTAS: votar es una opinión, no un
// cambio de la página, y si el guardado falla el voto vuelve atrás y lo dice.

import { useCallback, useEffect, useState } from "react";
import type { FeedbackRating, FeedbackReason, TurnFeedback } from "@/lib/chat/feedback-reasons";

export function useTurnFeedback(projectId: string) {
  const [votes, setVotes] = useState<Readonly<Record<string, TurnFeedback>>>({});
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/chat/feedback`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { feedback?: Record<string, TurnFeedback> } | null) => {
        if (alive && d?.feedback) setVotes(d.feedback);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);

  const save = useCallback(
    async (turnId: string, next: TurnFeedback | null): Promise<boolean> => {
      let before: TurnFeedback | undefined;
      setVotes((v) => {
        before = v[turnId];
        const copy = { ...v };
        if (next) copy[turnId] = next;
        else delete copy[turnId];
        return copy;
      });
      setFailed(null);
      try {
        const r = await fetch(`/api/projects/${projectId}/chat/feedback`, {
          method: next ? "POST" : "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next ? { turnId, ...next } : { turnId }),
        });
        if (!r.ok) throw new Error(String(r.status));
        return true;
      } catch {
        setVotes((v) => {
          const copy = { ...v };
          if (before) copy[turnId] = before;
          else delete copy[turnId];
          return copy;
        });
        setFailed(turnId);
        return false;
      }
    },
    [projectId],
  );

  return {
    votes,
    /** El turno cuyo último voto no se pudo guardar. */
    failed,
    rate: useCallback(
      (turnId: string, rating: FeedbackRating, reasons: readonly FeedbackReason[] = [], note: string | null = null) =>
        save(turnId, { rating, reasons, note }),
      [save],
    ),
    clear: useCallback((turnId: string) => save(turnId, null), [save]),
  };
}
