"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Publish-to-openlen.com modal.
//
// State machine:
//   idle      — input empty or unchanged from current claim
//   checking  — POST /api/subdomains/check in flight (debounced 300ms)
//   available — name passes regex, reserved, taken, and limit checks
//   invalid   — fails regex/length/xn--/numeric
//   reserved  — hits the reserved list
//   taken     — another user claims it
//   limit     — caller's plan cap is already used
//   publishing — POST /api/projects/[id]/publish in flight
//   unpublishing — DELETE /api/projects/[id]/publish in flight
//   error     — non-validation failure (network, 500)
// ─────────────────────────────────────────────────────────────────────────────

export interface PublishModalProject {
  id: string;
  subdomain: string | null;
  publishedAt: Date | null;
  hasUnpublishedChanges: boolean;
}

export interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  project: PublishModalProject;
  onSuccess: (subdomain: string | null) => void;
  /** Optional escape hatch — when present, the modal shows an "Or use my
   *  own domain" link that closes this modal and opens the Custom Domain
   *  flow. Keeps the *.openlen.com path discoverable without making it
   *  feel mandatory for users who already have their own domain. */
  onOpenCustomDomain?: () => void;
}

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "invalid" }
  | { kind: "reserved" }
  | { kind: "taken" }
  | { kind: "limit" };

const BASE_HOST = "openlen.com";

// Match server validators byte-for-byte so the client doesn't fire a
// pointless check round-trip for clearly-bad input. The server still
// re-validates — this is purely a UX optimization.
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function PublishModal({
  open,
  onClose,
  project,
  onSuccess,
  onOpenCustomDomain,
}: PublishModalProps) {
  const [value, setValue] = useState(project.subdomain ?? "");
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const [submitting, setSubmitting] = useState<
    "publishing" | "unpublishing" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset when the modal re-opens for a different project (or after success).
  useEffect(() => {
    if (!open) return;
    setValue(project.subdomain ?? "");
    setCheck({ kind: "idle" });
    setError(null);
    setSubmitting(null);
    setConfirmUnpublish(false);
    // Focus input after the modal mount animation settles.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, project.id, project.subdomain]);

  // Esc closes (when not submitting).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  const normalized = useMemo(() => value.trim().toLowerCase(), [value]);
  const isCurrent =
    project.subdomain !== null && normalized === project.subdomain;

  // Debounced availability check. Skips when the value matches the current
  // claim (re-publish doesn't need a check) and short-circuits clearly-bad
  // input to the local validators.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (!normalized) {
      setCheck({ kind: "idle" });
      return;
    }
    if (isCurrent) {
      setCheck({ kind: "available" });
      return;
    }
    if (normalized.length > 63 || !SUBDOMAIN_REGEX.test(normalized)) {
      setCheck({ kind: "invalid" });
      return;
    }
    if (normalized.startsWith("xn--") || /^[0-9]+$/.test(normalized)) {
      setCheck({ kind: "invalid" });
      return;
    }
    setCheck({ kind: "checking" });
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      void fetch("/api/subdomains/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: normalized }),
        signal: controller.signal,
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`check HTTP ${r.status}`);
          const data = (await r.json()) as
            | { available: true }
            | {
                available: false;
                reason: "invalid" | "reserved" | "taken" | "limit_reached";
              };
          if (data.available) {
            setCheck({ kind: "available" });
            return;
          }
          if (data.reason === "limit_reached") setCheck({ kind: "limit" });
          else if (data.reason === "taken") setCheck({ kind: "taken" });
          else if (data.reason === "reserved") setCheck({ kind: "reserved" });
          else setCheck({ kind: "invalid" });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          // eslint-disable-next-line no-console
          console.error("[publish-modal] availability check failed:", err);
          setCheck({ kind: "idle" });
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [normalized, isCurrent]);

  const doPublish = useCallback(async () => {
    if (submitting) return;
    // Allow the existing subdomain through even when the availability check
    // hasn't settled yet — same precedence as `canPublish` below.
    if (check.kind !== "available" && !isCurrent) return;
    setSubmitting("publishing");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: normalized }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        const reason = data?.error ?? `HTTP ${res.status}`;
        if (reason === "taken") setCheck({ kind: "taken" });
        else if (reason === "reserved") setCheck({ kind: "reserved" });
        else if (reason === "invalid") setCheck({ kind: "invalid" });
        else if (reason === "limit_reached") setCheck({ kind: "limit" });
        else setError(`Couldn't publish: ${reason}`);
        setSubmitting(null);
        return;
      }
      onSuccess(normalized);
      onClose();
    } catch (err) {
      setError(
        `Couldn't publish: ${err instanceof Error ? err.message : String(err)}`,
      );
      setSubmitting(null);
    }
  }, [submitting, check, isCurrent, project.id, normalized, onSuccess, onClose]);

  const doUnpublish = useCallback(async () => {
    if (submitting) return;
    if (!project.subdomain) return;
    setSubmitting("unpublishing");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/publish`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(`Couldn't unpublish: ${data?.error ?? `HTTP ${res.status}`}`);
        setSubmitting(null);
        return;
      }
      onSuccess(null);
      onClose();
    } catch (err) {
      setError(
        `Couldn't unpublish: ${err instanceof Error ? err.message : String(err)}`,
      );
      setSubmitting(null);
    }
  }, [submitting, project.id, project.subdomain, onSuccess, onClose]);

  if (!open) return null;

  const previewSub = normalized || "your-name";
  const fullUrl = `https://${previewSub}.${BASE_HOST}`;
  const isPublished = project.subdomain !== null;
  // canPublish stays true while the modal renders the project's current
  // subdomain — the availability effect briefly leaves check.kind === "idle"
  // on first paint (and on any reset) before the [normalized, isCurrent]
  // dependency settles, which would otherwise force the user to edit the
  // input just to wake up the Re-publish button. The server re-validates.
  const canPublish = !submitting && (check.kind === "available" || isCurrent);
  const wouldChangeName =
    isPublished && !isCurrent && check.kind === "available";

  // Action button label — three modes per spec. We always show "Re-publish"
  // when the user is on their current subdomain (even if hasUnpublishedChanges
  // is false), because other publish-time inputs (logo, form config, analytics
  // toggle) can change without touching the HTML and the user still needs a
  // way to push them live. Publish is content-addressed on disk so a no-op
  // re-publish is essentially free.
  let primaryLabel: string;
  if (submitting === "publishing") primaryLabel = "Publishing…";
  else if (wouldChangeName) primaryLabel = "Move to new subdomain";
  else if (isPublished && isCurrent) primaryLabel = "Re-publish";
  else primaryLabel = "Publish";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-900">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-coral-50 dark:bg-coral-500/10 text-coral-600 dark:text-coral-400">
              <Globe size={14} />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-tight truncate">
                {isPublished ? "Manage publish" : "Publish to openlen.com"}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">
                {isPublished
                  ? "Pick a new name, re-publish, or take it down."
                  : "Pick a name. Live on the public web in a second."}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting !== null}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          <div>
            <label
              htmlFor="publish-subdomain"
              className="block text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-semibold mb-1.5"
            >
              Subdomain
            </label>
            <div
              className={cn(
                "flex items-stretch rounded-lg bg-zinc-50 dark:bg-zinc-900 ring-1 transition focus-within:ring-2",
                check.kind === "available"
                  ? "ring-emerald-300 dark:ring-emerald-500/40 focus-within:ring-emerald-500/40"
                  : check.kind === "invalid" ||
                      check.kind === "reserved" ||
                      check.kind === "taken" ||
                      check.kind === "limit"
                    ? "ring-red-300 dark:ring-red-500/40 focus-within:ring-red-500/40"
                    : "ring-zinc-200 dark:ring-zinc-800 focus-within:ring-coral-500/40",
              )}
            >
              <input
                ref={inputRef}
                id="publish-subdomain"
                value={value}
                onChange={(e) =>
                  setValue(e.target.value.toLowerCase().replace(/\s+/g, ""))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canPublish) {
                    e.preventDefault();
                    void doPublish();
                  }
                }}
                placeholder="your-name"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={submitting !== null}
                className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-[13.5px] font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none disabled:opacity-50"
              />
              <span className="inline-flex shrink-0 items-center px-3 text-[13px] text-zinc-500 dark:text-zinc-400 border-l border-zinc-200 dark:border-zinc-800 select-none">
                .{BASE_HOST}
              </span>
            </div>
            <div className="mt-2 min-h-[18px]">
              <Status check={check} isCurrent={isCurrent} url={fullUrl} />
            </div>
          </div>

          <div className="rounded-lg bg-zinc-50/60 dark:bg-zinc-900/50 ring-1 ring-zinc-200 dark:ring-zinc-800 px-3.5 py-3">
            <div className="text-[10.5px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
              Preview
            </div>
            <div className="text-[13px] font-mono text-zinc-700 dark:text-zinc-300 break-all">
              {fullUrl}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-500/10 ring-1 ring-red-200 dark:ring-red-500/30 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="text-[11px] text-zinc-500 leading-relaxed">
            Free tier: 1 published page. Pro: 10. Lowercase letters, numbers,
            and hyphens (1–63 chars).
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50/60 dark:bg-zinc-900/40">
          <div className="flex items-center gap-2">
            {isPublished &&
              (confirmUnpublish ? (
                <>
                  <span className="text-[11px] text-red-600 dark:text-red-400">
                    Sure?
                  </span>
                  <button
                    type="button"
                    onClick={() => void doUnpublish()}
                    disabled={submitting !== null}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 ring-1 ring-red-200 dark:ring-red-500/30 hover:bg-red-100 dark:hover:bg-red-500/20 transition disabled:opacity-50"
                  >
                    {submitting === "unpublishing" ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    Yes, unpublish
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmUnpublish(false)}
                    disabled={submitting !== null}
                    className="h-8 px-2.5 rounded-md text-[12px] font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                  >
                    No
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmUnpublish(true)}
                  disabled={submitting !== null}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium text-zinc-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition disabled:opacity-50"
                >
                  <Trash2 size={12} /> Unpublish
                </button>
              ))}
          </div>
          <div className="flex items-center gap-2">
            {/* Escape hatch — when the user has their own domain ready,
                they shouldn't have to think about choosing a *.openlen.com
                slug. Clicking this routes straight to the Custom Domain
                flow, which auto-publishes to an internal slug behind the
                scenes. Hidden once a subdomain is claimed (the modal is
                in "manage" mode at that point). */}
            {onOpenCustomDomain && !isPublished && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenCustomDomain();
                }}
                className="mr-auto inline-flex items-center gap-1 h-8 px-2 rounded-md text-[12px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-coral-600 dark:hover:text-coral-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
              >
                Or use my own domain
                <span aria-hidden>→</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={submitting !== null}
              className="h-8 px-3 rounded-md text-[12px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void doPublish()}
              disabled={!canPublish}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium transition",
                canPublish
                  ? "bg-coral-500 text-white hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed",
              )}
            >
              {submitting === "publishing" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Sparkles size={11} />
              )}
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Status({
  check,
  isCurrent,
  url,
}: {
  check: CheckState;
  isCurrent: boolean;
  url: string;
}) {
  if (check.kind === "idle") {
    return (
      <span className="text-[11px] text-zinc-400">Choose a name above.</span>
    );
  }
  if (check.kind === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Loader2 size={11} className="animate-spin" /> Checking availability…
      </span>
    );
  }
  if (check.kind === "available") {
    if (isCurrent) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={11} /> This is your current page —{" "}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
          >
            visit <ExternalLink size={9} />
          </a>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={11} /> Available
      </span>
    );
  }
  if (check.kind === "invalid") {
    return (
      <span className="text-[11px] text-red-600 dark:text-red-400">
        Use lowercase letters, numbers, and hyphens (not leading/trailing).
      </span>
    );
  }
  if (check.kind === "reserved") {
    return (
      <span className="text-[11px] text-red-600 dark:text-red-400">
        This name is reserved. Try another.
      </span>
    );
  }
  if (check.kind === "taken") {
    return (
      <span className="text-[11px] text-red-600 dark:text-red-400">
        Already taken. Try another.
      </span>
    );
  }
  if (check.kind === "limit") {
    return (
      <span className="text-[11px] text-red-600 dark:text-red-400">
        Plan cap reached — unpublish another page or upgrade.
      </span>
    );
  }
  return null;
}
