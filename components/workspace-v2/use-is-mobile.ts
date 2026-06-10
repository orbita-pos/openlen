// Single source for the workspace's mobile breakpoint (< md). SSR-safe:
// renders false on the server, syncs to the real viewport after mount and
// tracks rotation/resize via matchMedia.
"use client";

import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isMobile;
}
