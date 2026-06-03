"use client";

// Tiny cross-component signal: is an AI generation/redesign in flight on /new?
// The locale switcher lives in the header (outside the workspace's state tree),
// and switching locale navigates (router.replace) → /new remounts → the live
// generation + its SSE stream are lost. The switcher subscribes here and
// disables itself while busy so a mid-generation language switch can't drop the
// page being built. The /new page publishes the flag from its generating state.

import { useSyncExternalStore } from "react";

let busy = false;
const listeners = new Set<() => void>();

export function setGenerationBusy(value: boolean): void {
  if (busy === value) return;
  busy = value;
  for (const l of listeners) l();
}

export function useGenerationBusy(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => busy,
    () => false,
  );
}
