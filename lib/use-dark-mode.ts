"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "inari:dark";

// Dark mode is applied pre-paint by the inline script in app/layout.tsx — it
// sets the `.dark` class on <html> from localStorage before React mounts, so
// there's no flash and no flip when navigating between routes. This hook only
// mirrors that into React state (so the toggle renders the right icon) and
// writes changes back.
export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(false);

  // Sync state to the resolved preference once mounted.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    setDark(
      stored === null
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : stored === "1",
    );
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
