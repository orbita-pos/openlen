"use client";

// THE PERSON'S INSTALLED TOOLS, live (spec local 2026-11-04-herramientas-hechas-por-len, §4.11): fetched when the
// workspace opens, again when the window regains focus, and whenever something installs, removes, restores or
// switches one (`TOOLS_CHANGED_EVENT`). Tools off, or nobody signed in: an empty list.
import { useCallback, useEffect, useState } from "react";

import type { InstalledToolView } from "@/lib/tools/types";

export const TOOLS_CHANGED_EVENT = "openlen:tools-changed";

/** Tell every open list that the person's tools changed. */
export function announceToolsChanged(): void {
  window.dispatchEvent(new Event(TOOLS_CHANGED_EVENT));
}

export function useInstalledTools(locale: string): { tools: InstalledToolView[]; person: { name: string }; available: boolean; paid: boolean; reload: () => void } {
  const [tools, setTools] = useState<InstalledToolView[]>([]);
  const [person, setPerson] = useState<{ name: string }>({ name: "" });
  // False when the server said tools are off (404) or the person isn't signed in: nothing of tools is drawn.
  const [available, setAvailable] = useState(false);
  const [paid, setPaid] = useState(false);
  const reload = useCallback(() => {
    void fetch(`/api/tools?locale=${encodeURIComponent(locale)}`, { cache: "no-store" })
      .then(async (res) => {
        setAvailable(res.ok);
        return res.ok ? ((await res.json()) as { tools?: InstalledToolView[]; person?: { name: string }; paid?: boolean }) : {};
      })
      .catch(() => ({}) as { tools?: InstalledToolView[]; person?: { name: string }; paid?: boolean })
      .then((body) => {
        setTools(body.tools ?? []);
        if (body.person) setPerson(body.person);
        setPaid(body.paid === true);
      });
  }, [locale]);
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    window.addEventListener(TOOLS_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener(TOOLS_CHANGED_EVENT, reload);
    };
  }, [reload]);
  return { tools, person, available, paid, reload };
}
