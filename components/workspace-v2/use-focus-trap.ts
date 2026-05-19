"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/**
 * Focus trap for modal-like overlays:
 *  - On open: focuses the first focusable element (or the container itself).
 *  - On Tab/Shift+Tab: cycles within the container — Tab from last → first,
 *    Shift+Tab from first → last.
 *  - On close: restores focus to whatever was focused before the modal opened.
 *
 * Pair with an Escape handler (already done in our modals) for the WCAG
 * "Easy Dismiss" requirement.
 */
export function useFocusTrap(active: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    const container = containerRef.current;
    if (!container) return;

    // Defer to next microtask so React has painted the new DOM.
    queueMicrotask(() => {
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0];
      if (first) first.focus();
      else container.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const c = containerRef.current;
      if (!c) return;
      const focusables = Array.from(
        c.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !c.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore focus to whatever opened the modal.
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {
          /* element may have been removed */
        }
      }
    };
  }, [active]);

  return containerRef;
}
