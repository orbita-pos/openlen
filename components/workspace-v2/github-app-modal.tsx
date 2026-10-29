"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, ExternalLink, GitBranch, Loader2, Unplug, X } from "lucide-react";

import { useFocusTrap } from "./use-focus-trap";

// «Conectar GitHub» (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): the owner connects OpenLen's GitHub
// App and sees which repository the project pushes to. No git buttons — like Claude Code, git is asked of Len or typed
// in the Code lens terminal. Connecting is a full-page trip to GitHub; the workspace reopens this on the way back.

interface GitHubAppStatus {
  configured: boolean;
  accounts: { login: string; type: "User" | "Organization" }[];
  origin: string | null;
}

export interface GitHubAppModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** `github_error` from the callback (denied / exchange), shown when it reopens this. */
  initialErrorKey?: string | null;
}

export function GitHubAppModal({ open, onClose, projectId, initialErrorKey }: GitHubAppModalProps) {
  const t = useTranslations("modalsDeploy.githubApp");
  const locale = useLocale();
  const [status, setStatus] = useState<GitHubAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const trapRef = useFocusTrap(open);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/integrations/github-app?project=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as GitHubAppStatus);
    } catch {
      setError(t("errors.load"));
    }
  }, [projectId, t]);

  useEffect(() => {
    if (!open) return;
    setError(initialErrorKey === "denied" || initialErrorKey === "exchange" ? t(`errors.${initialErrorKey}`) : null);
    void refresh();
  }, [open, initialErrorKey, refresh, t]);

  const connect = () => {
    setConnecting(true);
    window.location.href = `/api/integrations/github-app/install?project=${encodeURIComponent(projectId)}&locale=${encodeURIComponent(locale)}`;
  };

  const disconnect = async () => {
    if (!window.confirm(t("confirmDisconnect"))) return;
    const res = await fetch(`/api/integrations/github-app?project=${encodeURIComponent(projectId)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError(t("errors.load"));
    await refresh();
  };

  if (!open) return null;
  const connected = (status?.accounts.length ?? 0) > 0;
  const origin = status?.origin?.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") ?? null;

  return (
    <div ref={trapRef} role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-elev border bd shadow-elev">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b bd bg-elev rounded-t-2xl">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[var(--accent)]">
              <GitBranch size={14} />
            </span>
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight fg">{t("title")}</h2>
              <p className="text-[11px] fg-faint">{t("subtitle")}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover transition fg-muted" aria-label={t("close")}>
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-md ring-1 ring-red-200 dark:ring-red-500/30 bg-red-50/60 dark:bg-red-500/5 px-3 py-2 text-[12px] text-red-800 dark:text-red-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!status ? (
            <div className="flex items-center gap-2 text-[12px] fg-faint py-4">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : !status.configured ? (
            <div className="rounded-lg ring-1 ring-[color:var(--border)] bg-app p-4">
              <div className="text-[13px] font-semibold fg">{t("notConfigured.title")}</div>
              <p className="mt-1 text-[12px] fg-faint">{t("notConfigured.body")}</p>
            </div>
          ) : !connected ? (
            <div className="space-y-3">
              <p className="text-[12.5px] fg-muted">{t("lead")}</p>
              <button
                type="button"
                onClick={connect}
                disabled={connecting}
                className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md bg-[var(--accent-strong)] text-white text-[12.5px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connecting ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />}
                {t("connect")}
              </button>
              <p className="text-[10.5px] fg-faint">{t("privacy")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-[11.5px] text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={12} />
                <span>{t("connectedAs", { account: status.accounts.map((a) => a.login).join(", ") })}</span>
              </div>
              <div>
                <div className="text-[11.5px] font-medium fg mb-1.5">{t("repository")}</div>
                {origin ? (
                  <a
                    href={`https://github.com/${origin}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] font-mono fg hover:text-[var(--accent)] transition"
                  >
                    {origin} <ExternalLink size={11} />
                  </a>
                ) : (
                  <p className="text-[12px] fg-faint">{t("noRepository")}</p>
                )}
              </div>
              <p className="text-[10.5px] fg-faint">{t("privacy")}</p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1">
                  <a
                    href="https://github.com/settings/installations"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-medium fg-muted hover:bg-hover transition"
                  >
                    <ExternalLink size={12} /> {t("manage")}
                  </a>
                  <button type="button" onClick={connect} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-medium fg-muted hover:bg-hover transition">
                    <GitBranch size={12} /> {t("addAccount")}
                  </button>
                </div>
                <button type="button" onClick={() => void disconnect()} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-medium fg-muted hover:bg-hover transition">
                  <Unplug size={12} /> {t("disconnect")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
