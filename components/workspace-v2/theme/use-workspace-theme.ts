"use client";

// WHICH THEME THE WORKSPACE PAINTS (spec local 2026-11-27-temas-del-workspace, §4.4): what `GET /api/themes` says
// applies to this person in this project (`lib/themes/resolve.ts` decides; this only reads it), and the picker's
// «Vista previa» — a theme shown in THIS TAB only, kept in memory until it ends or the page goes, like the `preview` of
// Claude Code's `theme-examples`. The preview and the reload are one store for the whole tab, so the picker (another
// component, Task 9) and the layer behind the workspace see the same thing without passing anything down.
//
// Every failure is «no theme»: themes off (404), signed out, a network error. Nothing goes to the console — a theme is
// decoration, and the workspace works the same without one (Review Focus 2).
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocale } from "next-intl";

import type { ResolvedTheme } from "@/lib/themes/resolve";

// ─── the tab's own store: the preview and a reload counter ──────────────────

let previewRef: string | null = null;
let reloads = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Shows a theme in this tab without saving it; `null` ends the preview. */
export function previewWorkspaceTheme(ref: string | null): void {
  if (previewRef === ref) return;
  previewRef = ref;
  emit();
}

/** Reads the picks again (after the picker saves one, or Len's `set_theme`). */
export function reloadWorkspaceThemes(): void {
  reloads += 1;
  emit();
}

const snapshot = () => `${reloads}\u0000${previewRef ?? ""}`;
const previewSnapshot = () => previewRef;

/** The ref being previewed in this tab, or null — and nothing else: no read of the themes (the picker has its own). */
export function useThemePreview(): string | null {
  return useSyncExternalStore(subscribe, previewSnapshot, () => null);
}

// ─── the hook ───────────────────────────────────────────────────────────────

interface ThemeAnswer {
  resolved: ResolvedTheme | null;
  twin: ResolvedTheme | null;
}

export interface WorkspaceTheme extends ThemeAnswer {
  /** The ref being previewed in this tab, or null. */
  previewing: string | null;
  preview(ref: string | null): void;
  reload(): void;
}

function themesUrl(projectId: string | null, locale: string, preview: string | null): string {
  const query = new URLSearchParams();
  if (projectId) query.set("project", projectId);
  query.set("locale", locale);
  if (preview !== null) query.set("preview", preview);
  return `/api/themes?${query.toString()}`;
}

async function readThemes(url: string, preview: boolean, signal: AbortSignal): Promise<ThemeAnswer> {
  const none: ThemeAnswer = { resolved: null, twin: null };
  try {
    const res = await fetch(url, { cache: "no-store", signal });
    if (!res.ok) return none;
    const body = (await res.json()) as { resolved?: ResolvedTheme | null; twin?: ResolvedTheme | null; previewed?: { resolved: ResolvedTheme; twin: ResolvedTheme | null } | null };
    // A preview the server could not resolve shows the pick, as if there were no preview.
    const source = preview && body.previewed ? body.previewed : body;
    return { resolved: source.resolved ?? null, twin: source.twin ?? null };
  } catch {
    return none;
  }
}

// The last answer, kept in this browser per project, so a reload paints the theme at once instead of the default
// workspace for the second or two `GET /api/themes` takes (seen in the browser on 27/11). It is only a head start: the
// server's answer always replaces it. Storage can be missing or throw (private window, blocked site data): then there
// is simply no head start.
const CACHE_PREFIX = "openlen:workspace-theme:";

function cachedAnswer(projectId: string | null): ThemeAnswer | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + (projectId ?? ""));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ThemeAnswer;
    return parsed && typeof parsed === "object" && "resolved" in parsed ? { resolved: parsed.resolved ?? null, twin: parsed.twin ?? null } : null;
  } catch {
    return null;
  }
}

function rememberAnswer(projectId: string | null, answer: ThemeAnswer): void {
  try {
    const key = CACHE_PREFIX + (projectId ?? "");
    if (answer.resolved === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(answer));
  } catch {
    // no head start next time
  }
}

/** The theme that applies to this person in `projectId` (`null` = none open: only «everywhere»), and its twin. */
export function useWorkspaceTheme(projectId: string | null): WorkspaceTheme {
  const locale = useLocale();
  const key = useSyncExternalStore(subscribe, snapshot, () => "");
  const preview = key === "" ? null : previewRef;
  const [answer, setAnswer] = useState<ThemeAnswer>({ resolved: null, twin: null });

  useEffect(() => {
    const controller = new AbortController();
    // A head start from this browser's last answer (never for a preview, which is not saved).
    if (preview === null) {
      const cached = cachedAnswer(projectId);
      if (cached) setAnswer(cached);
    }
    void readThemes(themesUrl(projectId, locale, preview), preview !== null, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setAnswer(next);
      if (preview === null) rememberAnswer(projectId, next);
    });
    return () => controller.abort();
    // `key` carries the reload counter: a reload with the same preview reads again.
  }, [projectId, locale, preview, key]);

  return { ...answer, previewing: preview, preview: previewWorkspaceTheme, reload: reloadWorkspaceThemes };
}
