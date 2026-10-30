"use client";

// Len Watch's state for one project (GET /api/projects/[id]/len-watch), looked at again every 30 s
// while an incident stands — the notice moves on its own (Len working → ready → fixed).
import { useCallback, useEffect, useState } from "react";

import type { LenWatchStatus } from "@/lib/len-watch/types";

const POLL_MS = 30_000;

export function useLenWatch(projectId: string | undefined): { status: LenWatchStatus | null; reload: () => Promise<void>; setStatus: (s: LenWatchStatus | null) => void } {
  const [status, setStatus] = useState<LenWatchStatus | null>(null);
  const reload = useCallback(async () => {
    if (!projectId) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/len-watch`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setStatus((await r.json()) as LenWatchStatus);
    else if (r?.status === 404) setStatus(null);
  }, [projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const active = status?.incident != null;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [active, reload]);
  return { status, reload, setStatus };
}
