"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "inari:dark";

/**
 * The person's OWN mode: what they saved, else what their system prefers — the one rule both the toggle (`useDarkMode`)
 * and the workspace's theme layer (`theme-backdrop.tsx`) decide by, so the two never disagree about which window is
 * the person's. Never the `.dark` class: a theme may be forcing that. Storage can be missing or throw (private window,
 * blocked site data): then the system's preference decides.
 */
export function personPrefersDark(): boolean {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored !== null) return stored === "1";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// Dark mode is applied pre-paint by the inline script in app/layout.tsx — it
// sets the `.dark` class on <html> from localStorage before React mounts, so
// there's no flash and no flip when navigating between routes. This hook only
// mirrors that into React state (so the toggle renders the right icon) and
// writes changes back.
export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(false);

  // Sync state to the resolved preference once mounted.
  useEffect(() => {
    setDark(personPrefersDark());
  }, []);

  // Apply + persist on real changes only. Skipping the first run is what
  // stops a freshly-mounted page (after a route change) from yanking the
  // `.dark` class off <html> before the effect above resolves the choice.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    document.documentElement.classList.toggle("dark", dark);
    window.localStorage.setItem(STORAGE_KEY, dark ? "1" : "0");
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  return [dark, toggle];
}
