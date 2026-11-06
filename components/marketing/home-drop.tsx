"use client";

// DROP ANYWHERE ON THE HOME (Jesús, 06/11: «sólo debe haber un input y debe ser el que tenga todo»): /new's start screen
// took files dropped anywhere on it (spec local 2026-10-27-chat-drop-and-images), and the home's box is the only one
// now, so the home does. The zone wraps the home's frame (`home-shell.tsx`) and the box (`hero-prompt-input.tsx`), far below it,
// lends its way in through this context — the same `addFilesRef` /new's composer lends its screen.

import { createContext, useContext, useRef, type MutableRefObject, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useFileDrop } from "@/components/workspace-v2/chat/use-file-drop";
import { DropOverlay } from "@/components/workspace-v2/chat/drop-overlay";

type AddFiles = MutableRefObject<((files: File[]) => void) | null>;

const DropContext = createContext<AddFiles | null>(null);

/** Where the home's box lends its way in; `null` outside the zone. */
export function useHomeDropRef(): AddFiles | null {
  return useContext(DropContext);
}

export function HomeDropZone({ className, children }: { className: string; children: ReactNode }) {
  const t = useTranslations("panelsChat");
  const addFilesRef = useRef<((files: File[]) => void) | null>(null);
  const drop = useFileDrop({ enabled: true, onFiles: (files) => addFilesRef.current?.(files) });
  return (
    <DropContext.Provider value={addFilesRef}>
      <div className={className} {...drop.handlers}>
        {drop.dragging && (
          // `fixed`: the home scrolls past its first screen on a short window; the overlay stays on what is in view.
          <div className="nc pointer-events-none fixed inset-0 z-[55]">
            <DropOverlay label={t("composer.dropHere")} />
          </div>
        )}
        {children}
      </div>
    </DropContext.Provider>
  );
}
