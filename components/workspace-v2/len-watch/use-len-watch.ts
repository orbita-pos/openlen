"use client";

// Len Watch's state for one project (GET /api/projects/[id]/len-watch), looked at again every 30 s
// while an incident stands or a fix waits to be brought — the notice moves on its own (Len working →
// ready → fixed; the fix brought by Len or from the phone) — and whenever the project's folder changes
// (the publish modal brought the fix).
import { useCallback, useEffect, useState } from "react";

import type { LenWatchStatus } from "@/lib/len-watch/types";
import { onFolderChanged } from "@/lib/lienzo/carpeta-cambiada";

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
  useEffect(() => (projectId ? onFolderChanged(projectId, () => void reload()) : undefined), [projectId, reload]);
  const active = status?.incident != null || status?.pendingFix != null;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [active, reload]);
  return { status, reload, setStatus };
}
