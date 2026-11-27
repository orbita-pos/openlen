"use client";

// WHAT THE PERSON HAS ON THE DESKTOP, OF THIS PROJECT (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.4, §4.6): read
// from `GET /api/projects/[id]/desktop`. The route answers a 404 to anyone who isn't the owner and when the switch is off
// (`OPENLEN_DESKTOP_APPS=0`), so the client never needs to know either: `null` — not read yet, or nothing to offer — and
// the menus leave their entries out. Server modules stay on the server; this only types what the route answers.
import { useCallback, useEffect, useState } from "react";

import type { InstallBlock } from "@/lib/desktop-apps/install";
import type { DesktopAppView } from "@/lib/desktop-apps/view";

/** What the route can tell beforehand makes an install impossible (it answers the same to a POST): the reasons the menu shows
 *  under a disabled entry. */
const BLOCKS: ReadonlySet<string> = new Set<InstallBlock>(["plan_required", "uses_stripe", "not_an_app", "tool_not_installed"]);

export interface DesktopAppState {
  /** The person's installation of this project (not a removed one), or none. */
  desktopApp: DesktopAppView | null;
  /** The project's files moved on since it was installed. */
  updateAvailable: boolean;
  /** The project also has a published site, which shares its production data (spec §5). */
  published: boolean;
  /** Why an install or an update would be refused right now — the route's own answer to the question the POST would get, with
   *  no gate run — or null when it can go ahead. The menu shows it before any tap (Claude offers install only where it can work). */
  blockedBy: InstallBlock | null;
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
    // A reason this client doesn't know is not a block it could say: the entry stays as it was and the POST answers for itself.
    blockedBy: typeof d.blockedBy === "string" && BLOCKS.has(d.blockedBy) ? (d.blockedBy as InstallBlock) : null,
  };
}

export function desktopRoute(projectId: string): string {
  return `/api/projects/${projectId}/desktop`;
}

/** The publish dialog's question (spec §5): does ANYONE have this app on their desktop, sharing its production data with the
 *  site? Whoever can publish hears it — an editor's publish migrates the database the owner's frozen release uses — so it is
 *  `GET ?for=publish`, a boolean for anyone with edit access, not the owner's read above. False while unknown or on any failure. */
export function useDesktopInstalledForPublish(projectId: string | undefined, enabled: boolean): boolean {
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (!projectId || !enabled) {
      setInstalled(false);
      return;
    }
    let cancelled = false;
    void fetch(`${desktopRoute(projectId)}?for=publish`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        if (!cancelled) setInstalled(!!d && typeof d === "object" && (d as Record<string, unknown>).installed === true);
      })
      .catch(() => {
        if (!cancelled) setInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  return installed;
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
