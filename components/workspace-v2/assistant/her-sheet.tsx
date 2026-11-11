"use client";

// A SMALL SHEET OF HER PLACE (11/11, Jesús: her dialogs «nivel macOS»): one question, one field, two buttons — a
// compact panel in the middle of the window, over the veil. `ModalShell` is the workshop's dialog, with its header bar
// and its widths for forms and grids; this is for what is answered in a line. It goes to <body> for the same reason
// that one does (a `fixed` veil resolves against the nearest transformed ancestor), and it carries her color with it,
// because the variables her place sets do not reach a portal.
import { createContext, useContext, useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useFocusTrap } from "../use-focus-trap";

/** Her color as CSS variables (`tintStyle`), for what is drawn outside her place's root. */
export const HerTint = createContext<CSSProperties>({});

export function HerSheet({
  open,
  onClose,
  titleId,
  title,
  note,
  dismissable = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: ReactNode;
  /** Under the title, quiet. */
  note?: ReactNode;
  /** false while it is saving: neither the veil nor Escape closes it. */
  dismissable?: boolean;
  children: ReactNode;
}) {
  const trap = useFocusTrap(open);
  const tint = useContext(HerTint);
  useEffect(() => {
    if (!open || !dismissable) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, dismissable, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="workspace-v2 ol-scrim fade-in fixed inset-0 z-50 flex items-center justify-center p-4" style={tint} onClick={() => dismissable && onClose()}>
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-her-sheet=""
        className="slide-down w-full max-w-[360px] rounded-[20px] border bd-strong bg-elev p-5 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-center text-[15px] font-semibold fg">
          {title}
        </h2>
        {note && <p className="mt-1 text-center text-[12px] leading-snug fg-muted">{note}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** The two looks of a button in her place: the one that does it, in her color; the one that leaves, quiet. */
export const HER_PRIMARY = "her-fill inline-flex h-9 items-center justify-center rounded-[10px] px-4 text-[13px] font-semibold transition hover:brightness-105 active:scale-[0.98] disabled:opacity-45";
export const HER_QUIET = "inline-flex h-9 items-center justify-center rounded-[10px] bg-hover px-4 text-[13px] font-medium fg transition hover:brightness-110 active:scale-[0.98] disabled:opacity-45";
/** A row of her settings menu. */
export const HER_ROW = "flex w-full min-w-0 items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left text-[13px] fg transition-colors hover:bg-hover disabled:opacity-50";
/** A switch of her settings: on, it is her color. */
export const herSwitch = (on: boolean) => `relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "her-on" : "bg-hover"}`;
export const herKnob = (on: boolean) => `absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-[left] ${on ? "left-[18px]" : "left-[2px]"}`;
