"use client";

/**
 * WHERE THIS TAB LOADS LEN'S VISUALS FROM (local spec 2026-10-16-len-inline-visuals).
 * Asked once per tab to `/api/visual-frame-url`: `undefined` while it loads,
 * `null` when there is no isolated host (the frame uses `srcdoc`), or the URL.
 */
import { useEffect, useState } from "react";

let request: Promise<string | null> | null = null;
let known: string | null | undefined;

function ask(): Promise<string | null> {
  request ??= fetch("/api/visual-frame-url")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: unknown) => {
      const url = (d as { url?: unknown } | null)?.url;
      return typeof url === "string" ? url : null;
    })
    .catch(() => null);
  return request;
}

export function useVisualFrameUrl(): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(known);
  useEffect(() => {
    if (known !== undefined) return;
    let alive = true;
    void ask().then((value) => {
      known = value;
      if (alive) setUrl(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return url;
}
