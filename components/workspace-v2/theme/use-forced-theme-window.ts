"use client";

// THE WINDOW A THEME FORCES, FOR THE DARK/LIGHT TOGGLE (spec local 2026-11-27-temas-del-workspace, §4.3): Claude Code
// keeps the user's setting and the theme overrides only the window (`overrideColorScheme`). So the toggle keeps showing
// the person's own setting — what a click changes — and only says, while a theme forces the other window, that the
// theme is the reason. The layer marks `<html>` with the window it forces (`FORCED_WINDOW_ATTR`); this reads the mark.
import { useSyncExternalStore } from "react";

/** On `<html>` while a theme forces the window; its value is the window (`dark` or `light`). Set only by the layer. */
export const FORCED_WINDOW_ATTR = "data-theme-forced-window";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [FORCED_WINDOW_ATTR] });
  return () => observer.disconnect();
}

function read(): "dark" | "light" | null {
  const value = document.documentElement.getAttribute(FORCED_WINDOW_ATTR);
  return value === "dark" || value === "light" ? value : null;
}

/** The window a theme is forcing right now (`dark` or `light`), or null when the window is the person's own. */
export function useForcedThemeWindow(): "dark" | "light" | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
