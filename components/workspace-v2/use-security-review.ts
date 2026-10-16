"use client";

// The security review of an open publish dialog: started when it opens,
// followed while it runs. The setter lets a 428 from the publish route replace
// what is shown.

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { ReviewView } from "@/lib/security-review/types";
import { startSecurityReview, waitForSecurityReview } from "@/lib/workspace-v2/security-review-request";

export function useSecurityReview(projectId: string, enabled: boolean, locale: string): readonly [ReviewView | null, Dispatch<SetStateAction<ReviewView | null>>] {
  const [view, setView] = useState<ReviewView | null>(null);
  useEffect(() => {
    setView(null);
    if (!enabled) return;
    const ac = new AbortController();
    void (async () => {
      const started = await startSecurityReview(projectId, locale).catch(() => null);
      if (ac.signal.aborted) return;
      setView(started);
      if (started?.status !== "running") return;
      const done = await waitForSecurityReview(projectId, started.fingerprint, { signal: ac.signal }).catch(() => null);
      if (!ac.signal.aborted && done) setView(done);
    })();
    return () => ac.abort();
  }, [projectId, enabled, locale]);
  return [view, setView] as const;
}
