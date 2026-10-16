"use client";

// WHILE AN APP IS BORN, the canvas shows Len's workshop
// (`app-birth-workshop.tsx`); when the turn ends well it says the app is ready
// for a moment, fades, and the app shows. The rule of when is pure
// (`nextAppBirth`); this adds the clock.

import { useEffect, useState } from "react";

import { nextAppBirth, workshopOf, type AppBirth, type LatestTurn, type WorkshopView } from "@/lib/workspace-v2/app-birth";

/** How long «Your app is ready» stays, its fade included. */
export const READY_MS = 2200;
/** The fade at its end. */
export const LEAVE_MS = 400;

export interface AppBirthView {
  readonly view: WorkshopView;
  readonly startedAt: number;
  readonly finished: boolean;
  /** Fading out, the app about to show. */
  readonly leaving: boolean;
}

export function useAppBirth(turn: LatestTurn | null, bornAsApp: boolean): AppBirthView | null {
  const [birth, setBirth] = useState<AppBirth | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);

  useEffect(() => {
    setBirth((prev) => nextAppBirth(prev, turn, bornAsApp, Date.now()));
  }, [turn, bornAsApp]);

  const finishedId = birth && birth.finishedAt !== null ? birth.turnId : null;
  useEffect(() => {
    setLeaving(false);
    if (!finishedId) return;
    const fade = window.setTimeout(() => setLeaving(true), READY_MS - LEAVE_MS);
    const end = window.setTimeout(() => setEnded(finishedId), READY_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(end);
    };
  }, [finishedId]);

  if (!birth || !turn || birth.turnId === ended) return null;
  return { view: workshopOf(turn.actions), startedAt: birth.startedAt, finished: birth.finishedAt !== null, leaving };
}
