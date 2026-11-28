"use client";

// WHETHER A THEME CAN BE BORN HERE (spec local 2026-11-27-temas-del-workspace, §7): themes are on unless the server
// says otherwise (`HEAD /api/themes` → 404 with OPENLEN_THEMES=0), like «Juego» with `useGamesAvailable`. On from the
// start, so nothing pops; a network failure leaves it on, because the server ignores a theme birth when themes are off.

import { useEffect, useState } from "react";

export function useThemesAvailable(): boolean {
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let alive = true;
    void fetch("/api/themes", { method: "HEAD", cache: "no-store" })
      .then((res) => {
        if (alive && res.status === 404) setAvailable(false);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
