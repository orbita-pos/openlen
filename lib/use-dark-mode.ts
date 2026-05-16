"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "inari:dark";

export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const prefers =
      stored === null
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : stored === "1";
    setDark(prefers);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    window.localStorage.setItem(STORAGE_KEY, dark ? "1" : "0");
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  return [dark, toggle];
}
