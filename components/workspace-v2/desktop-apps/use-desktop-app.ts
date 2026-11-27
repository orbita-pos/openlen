"use client";

// WHAT THE PERSON HAS ON THE DESKTOP, OF THIS PROJECT (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.4, §4.6): read
// from `GET /api/projects/[id]/desktop`. The route answers a 404 to anyone who isn't the owner and when the switch is off
// (`OPENLEN_DESKTOP_APPS=0`), so the client never needs to know either: `null` — not read yet, or nothing to offer — and
// the menus leave their entries out. Server modules stay on the server; this only types what the route answers.
import { useCallback, useEffect, useState } from "react";

import type { DesktopAppView } from "@/lib/desktop-apps/view";

export interface DesktopAppState {
  /** The person's installation of this project (not a removed one), or none. */
  desktopApp: DesktopAppView | null;
  /** The project's files moved on since it was installed. */
  updateAvailable: boolean;
  /** The project also has a published site, which shares its production data (spec §5). */
  published: boolean;
}

function parse(data: unknown): DesktopAppState | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const app = d.desktopApp;
  return {
    // Anything but an object (null, or an answer of another shape) is «not installed».
    desktopApp: app && typeof app === "object" ? (app as DesktopAppView) : null,
    updateAvailable: d.updateAvailable === true,
    published: d.published === true,
  };
}

export function desktopRoute(projectId: string): string {
  return `/api/projects/${projectId}/desktop`;
}

/** `enabled` false = no request (a closed menu, a page, a visitor who isn't the owner). Reads again each time it turns on. */
export function useDesktopApp(projectId: string | undefined, enabled: boolean): { state: DesktopAppState | null; reload: () => void } {
  const [state, setState] = useState<DesktopAppState | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!projectId || !enabled) {
      setState(null);
      return;
    }
    let cancelled = false;
    void fetch(desktopRoute(projectId), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        if (!cancelled) setState(parse(d));
      })
      // Fail-soft: no answer, no entries. Nothing in the menu depends on this.
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled, tick]);

  return { state, reload };
}
