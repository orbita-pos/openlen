"use client";

// Len Watch's state for one project (GET /api/projects/[id]/len-watch), looked at again every 30 s
// while an incident stands or a fix waits to be brought — the notice moves on its own (Len working →
// ready → fixed; the fix brought by Len or from the phone) — or until the server first answers, and
// whenever the project's folder changes (the publish modal brought the fix).
import { useCallback, useEffect, useState } from "react";

import type { LenWatchStatus } from "@/lib/len-watch/types";
import { onFolderChanged } from "@/lib/lienzo/carpeta-cambiada";

const POLL_MS = 30_000;

export function useLenWatch(projectId: string | undefined): { status: LenWatchStatus | null; reload: () => Promise<void>; setStatus: (s: LenWatchStatus | null) => void } {
  const [status, setStatus] = useState<LenWatchStatus | null>(null);
  // Answered at least once (a state, or 404: Len Watch off). Until then it keeps asking: a busy server must not
  // leave the notice blank until a reload.
  const [answered, setAnswered] = useState(false);
  const reload = useCallback(async () => {
    if (!projectId) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/len-watch`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setStatus((await r.json()) as LenWatchStatus);
    else if (r?.status === 404) setStatus(null);
    if (r?.ok || r?.status === 404) setAnswered(true);
  }, [projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => (projectId ? onFolderChanged(projectId, () => void reload()) : undefined), [projectId, reload]);
  const active = !answered || status?.incident != null || status?.pendingFix != null;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [active, reload]);
  return { status, reload, setStatus };
}
