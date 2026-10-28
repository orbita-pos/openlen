"use client";

/**
 * «DROP TO ATTACH» over the chat or the start screen while files are dragged over it (spec local
 * 2026-10-27-chat-drop-and-images, Part A). It covers its `relative` parent and lets the drag
 * events through to it.
 */
import { Paperclip } from "lucide-react";

export function DropOverlay({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[inherit] bg-[color-mix(in_oklab,var(--bg-sidebar)_86%,transparent)] p-2 backdrop-blur-[2px] transition-opacity motion-reduce:transition-none"
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed bd-strong text-[13.5px] font-semibold fg">
        <Paperclip size={22} className="text-[var(--nc-accent-text)]" />
        {label}
      </div>
    </div>
  );
}
