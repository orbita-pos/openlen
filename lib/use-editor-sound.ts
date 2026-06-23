"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  playClick as play,
  playReward as reward,
  setVolume as applyVolume,
} from "@/lib/editor-sound";

// Editor-sound preference. Mirrors lib/use-dark-mode.ts (two-effect, firstRun
// guard, SSR-safe) but stores a VOLUME (0–1) instead of a boolean so the user
// can raise/lower it from the TopBar slider. DEFAULT 0 (OFF) — no unsolicited
// audio on a work tool; that also covers prefers-reduced-motion (decorative).
const STORAGE_KEY = "openlen:sound";
const DEFAULT_ON = 0.7; // level restored when un-muting from 0

export interface EditorSound {
  /** 0–1 master volume. 0 = muted. */
  volume: number;
  muted: boolean;
  /** Set the volume (0–1); previews a click at the new level. */
  setVolume: (v: number) => void;
  /** Mute (→0) / unmute (→ last non-zero or the default). */
  toggleMute: () => void;
  /** Plays a click iff volume > 0. Safe from any onClick. */
  playClick: () => void;
  /** Plays the publish-success reward iff volume > 0. */
  playReward: () => void;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function useEditorSound(): EditorSound {
  const [volume, setVolumeState] = useState(0); // SSR-safe constant; default OFF
  const lastNonZero = useRef(DEFAULT_ON);

  // Resolve from storage once mounted + sync the audio engine.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    let v = 0;
    if (stored !== null) {
      const parsed = Number.parseFloat(stored); // back-compat: old "1"/"0" parse fine
      v = Number.isFinite(parsed) ? clamp01(parsed) : 0;
    }
    setVolumeState(v);
    if (v > 0) lastNonZero.current = v;
    applyVolume(v); // syncs the engine's volume; does NOT create the context
  }, []);

  // Persist on real changes only (skip the first resolve run, like use-dark-mode).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, String(volume));
  }, [volume]);

  const setVolume = useCallback((v: number) => {
    const clamped = clamp01(v);
    if (clamped > 0) lastNonZero.current = clamped;
    applyVolume(clamped); // engine: immediate
    setVolumeState(clamped);
    if (clamped > 0) play(); // preview the click at the new level (engine-debounced)
  }, []);

  const toggleMute = useCallback(() => {
    setVolume(volume > 0 ? 0 : lastNonZero.current);
  }, [volume, setVolume]);

  const playClick = useCallback(() => {
    if (volume > 0) play();
  }, [volume]);
  const playReward = useCallback(() => {
    if (volume > 0) reward();
  }, [volume]);

  return { volume, muted: volume === 0, setVolume, toggleMute, playClick, playReward };
}
