"use client";

// Lightweight, dependency-free toast system for the workspace. One provider
// (mounted in the /new layout) holds the stack; any descendant calls useToast()
// to push a success / error / info toast. Styling rides the workspace design
// tokens (bg-elev / bd / fg / coral) so it inherits dark mode for free.
//
// Why hand-rolled instead of sonner: zero new dependency for the self-hosted
// standalone build, exact token/dark-mode parity, and it sits naturally next to
// the existing editor-sound reward (publish already plays an arpeggio — this
// adds the missing VISUAL confirmation).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, ExternalLink, Info, X } from "./icons";

export type ToastVariant = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  /** Opens in a new tab. Mutually exclusive with onClick (href wins). */
  href?: string;
  onClick?: () => void;
}

export interface ToastOptions {
  description?: string;
  action?: ToastAction;
  /** Auto-dismiss after this many ms. 0 = sticky (manual dismiss only). */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  variant: ToastVariant;
  title: string;
}

export interface ToastApi {
  success: (title: string, opts?: ToastOptions) => number;
  error: (title: string, opts?: ToastOptions) => number;
  info: (title: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const NOOP: ToastApi = {
  success: () => 0,
  error: () => 0,
  info: () => 0,
  dismiss: () => {},
};

const ToastContext = createContext<ToastApi | null>(null);

/** Returns the toast API. Safe to call without a provider — returns a no-op so
 *  callers never crash (e.g. during SSR or in tests). */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 4500,
  info: 4500,
  error: 7000, // errors linger — the user needs time to read what failed
};

const MAX_VISIBLE = 4;

export function ToastProvider({
  children,
  dismissLabel = "Dismiss",
}: {
  children: ReactNode;
  /** Accessible name for each toast's close button (localized by the mount). */
  dismissLabel?: string;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, title: string, opts?: ToastOptions): number => {
      const id = (idRef.current += 1);
      setToasts((prev) => {
        const next = [...prev, { id, variant, title, ...opts }];
        // Cap the stack so a burst never towers off-screen — drop the oldest.
        return next.length > MAX_VISIBLE
          ? next.slice(next.length - MAX_VISIBLE)
          : next;
      });
      return id;
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, opts) => push("success", title, opts),
      error: (title, opts) => push("error", title, opts),
      info: (title, opts) => push("info", title, opts),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} dismissLabel={dismissLabel} />
    </ToastContext.Provider>
  );
}

function Toaster({
  toasts,
  onDismiss,
  dismissLabel,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  dismissLabel: string;
}) {
  if (toasts.length === 0) return null;
  return (
    // `workspace-v2` carries the design tokens + dark cascade; transparent so it
    // doesn't paint a full-screen background. Fixed, click-through except on the
    // cards themselves. z-[200] keeps toasts above every modal (domain z-[100]).
    <div
      className="workspace-v2 fixed inset-x-0 bottom-0 z-[200] flex flex-col items-center gap-2 p-4 pointer-events-none sm:inset-x-auto sm:right-0 sm:items-end sm:p-5"
      style={{ background: "transparent" }}
    >
      {toasts.map((t) => (
        <ToastRow
          key={t.id}
          toast={t}
          onDismiss={onDismiss}
          dismissLabel={dismissLabel}
        />
      ))}
    </div>
  );
}

const VARIANT_ICON: Record<ToastVariant, ReactNode> = {
  success: <Check size={13} />,
  error: <AlertTriangle size={13} />,
  info: <Info size={13} />,
};

// Tinted icon chip per variant. Coral (accent) for info to match the brand.
const VARIANT_CHIP: Record<ToastVariant, string> = {
  success:
    "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30",
  error:
    "bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30",
  info: "bg-[color:var(--accent)]/10 text-[var(--accent)] ring-[color:var(--accent)]/30",
};

function ToastRow({
  toast,
  onDismiss,
  dismissLabel,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
  dismissLabel: string;
}) {
  const duration = toast.duration ?? DEFAULT_DURATION[toast.variant];
  const timerRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clear();
    if (duration > 0) {
      timerRef.current = window.setTimeout(() => onDismiss(toast.id), duration);
    }
  }, [duration, onDismiss, toast.id, clear]);

  useEffect(() => {
    start();
    return clear;
  }, [start, clear]);

  const { action } = toast;

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      aria-live={toast.variant === "error" ? "assertive" : "polite"}
      onMouseEnter={clear}
      onMouseLeave={start}
      className="toast-in pointer-events-auto w-full max-w-sm rounded-xl bg-elev border bd shadow-elev px-3.5 py-3 flex items-start gap-2.5"
    >
      <span
        className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ${VARIANT_CHIP[toast.variant]}`}
      >
        {VARIANT_ICON[toast.variant]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium fg leading-snug">
          {toast.title}
        </div>
        {toast.description && (
          <div className="mt-0.5 text-[11.5px] fg-faint leading-snug break-words">
            {toast.description}
          </div>
        )}
        {action &&
          (action.href ? (
            <a
              href={action.href}
              target="_blank"
              rel="noreferrer"
              onClick={() => onDismiss(toast.id)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--accent)] hover:underline underline-offset-2"
            >
              {action.label} <ExternalLink size={10} />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                action.onClick?.();
                onDismiss(toast.id);
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--accent)] hover:underline underline-offset-2"
            >
              {action.label}
            </button>
          ))}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={dismissLabel}
        className="shrink-0 -mr-1 -mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition"
      >
        <X size={13} />
      </button>
    </div>
  );
}
