"use client";

// WHETHER THE «JUEGO» CARD IS DRAWN (spec local 2026-11-05-modo-juego-design, §8.1): games are on unless the
// server says otherwise (GET /api/games → 404 with OPENLEN_GAMES=0). On from the start, so the card doesn't pop in
// after a request; a network failure leaves it on, because the server ignores a game birth when games are off.

import { useEffect, useState } from "react";

export function useGamesAvailable(): boolean {
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let alive = true;
    void fetch("/api/games", { cache: "no-store" })
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
