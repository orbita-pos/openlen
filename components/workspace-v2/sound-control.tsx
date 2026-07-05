// Sound control — the speaker icon opens a small popover with a mute toggle +
// a volume slider (0–100%). Volume 0 = muted. Dragging the slider previews a
// click at the new level so the user can dial it in by ear.
//
// Moved out of top-bar.tsx (Session: workspace chrome redesign, Task 4) — the
// top bar dropped Sound entirely; Task 5 renders this in the preview toolbar,
// conditional on the page having music.

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Volume2, VolumeX } from "./icons";
import { IconBtn } from "./ui";

export interface SoundControlProps {
  volume: number;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  /** Trigger button size — matches the neighboring preview-toolbar IconBtns. Defaults to "md" (prior behavior). */
  size?: "sm" | "md";
}

export function SoundControl({ volume, onVolume, onToggleMute, size = "md" }: SoundControlProps) {
  const t = useTranslations("topbar");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const muted = volume === 0;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  const pct = Math.round(volume * 100);
  return (
    // data-no-sound: the global click listener skips this — the volume slider's
    // own setVolume preview is the only feedback here (avoids a double-click).
    <div className="relative" ref={ref} data-no-sound>

      <IconBtn
        label={muted ? t("sound.unmute") : t("sound.mute")}
        onClick={() => setOpen((o) => !o)}
        size={size}
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </IconBtn>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 flex items-center gap-2 rounded-lg border bd bg-elev shadow-card px-2.5 py-2 w-44">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? t("sound.unmute") : t("sound.mute")}
            className="shrink-0 fg-muted hover:fg transition"
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => onVolume(Number(e.target.value) / 100)}
            aria-label={t("sound.volume")}
            className="flex-1 h-1 cursor-pointer accent-[color:var(--accent)]"
          />
          <span className="shrink-0 w-8 text-right text-[10px] fg-faint tabular-nums">
            {pct}%
          </span>
        </div>
      )}
    </div>
  );
}
