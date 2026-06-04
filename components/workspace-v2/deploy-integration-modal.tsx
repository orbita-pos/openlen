"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFocusTrap } from "./use-focus-trap";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Loader2,
  Rocket,
  Triangle,
  Unplug,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Deploy-integration modal — one component for both export targets
// ("Deploy to Vercel" + "Push to GitHub"). Structurally mirrors
// custom-domain-modal.tsx but much simpler: connect once (OAuth), then deploy
// the project's static HTML and show the live URL. No DNS / auto-publish.
//
//   not connected → "Connect <provider>" (full-page nav to the OAuth start
//                    route; the workspace reopens this modal on return).
//   connected     → editable target name + Deploy/Re-deploy + live URL + a
//                    drift hint + Disconnect.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeployIntegrationModalProps {
  open: boolean;
  onClose: () => void;
  provider: "vercel" | "github";
  projectId: string;
  /** connect_error key from the OAuth callback (denied/state/exchange/
   *  not_configured). Shown as an error banner when the modal opens after a
   *  failed connect attempt. */
  initialErrorKey?: string | null;
}

interface DeployStatus {
  configured: boolean;
  connected: boolean;
  accountLabel: string | null;
  remoteName: string;
  liveUrl: string | null;
  lastDeployedAt: string | null;
  hasUnpublishedChanges: boolean;
}

const PROVIDER_LABEL: Record<"vercel" | "github", string> = {
  vercel: "Vercel",
  github: "GitHub",
};

// Mirror of the server NAME_RE — immediate feedback; the API re-validates.
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

export function DeployIntegrationModal({
  open,
  onClose,
  provider,
  projectId,
  initialErrorKey,
}: DeployIntegrationModalProps) {
  const t = useTranslations("modalsDeploy");
  const locale = useLocale();
  const label = PROVIDER_LABEL[provider];

  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True for a moment after a successful deploy — drives the "Publishing…"
  // notice so users don't read the first-load 404 (Pages/Vercel still building)
  // as a failure.
  const [justDeployed, setJustDeployed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/integrations/${provider}`,
      );
      if (!res.ok) {
        setError(t("errors.loadFailed"));
        return;
      }
      const data = (await res.json()) as DeployStatus;
      setStatus(data);
      setName((prev) => prev || data.remoteName);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [projectId, provider, t]);

  // Load status whenever the modal opens; surface any connect error carried
  // back from the OAuth callback.
  useEffect(() => {
    if (!open) return;
    setError(initialErrorKey ? t(`errors.${initialErrorKey}`) : null);
    setName("");
    setJustDeployed(false);
    void refresh();
  }, [open, initialErrorKey, refresh, t]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onConnect = () => {
    setConnecting(true);
    const url = `/api/integrations/${provider}/start?project=${encodeURIComponent(
      projectId,
    )}&locale=${encodeURIComponent(locale)}`;
    window.location.href = url;
  };

  const onDeploy = async () => {
    const trimmed = name.trim().toLowerCase();
    if (!NAME_RE.test(trimmed)) {
      setError(t("errors.invalidName"));
      return;
    }
    setDeploying(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/integrations/${provider}/deploy`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        liveUrl?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.ok) {
        if (body.error === "invalid_name") setError(t("errors.invalidName"));
        else if (body.error === "not_connected") {
          setError(t("errors.notConnected"));
          setStatus((s) => (s ? { ...s, connected: false } : s));
        } else if (body.error === "token_invalid") {
          setError(t("errors.tokenInvalid"));
          setStatus((s) => (s ? { ...s, connected: false } : s));
        } else if (body.message) {
          setError(t("errors.deployFailed", { message: body.message }));
        } else {
          setError(t("errors.deployGeneric"));
        }
        return;
      }
      await refresh();
      setJustDeployed(true);
    } catch {
      setError(t("errors.network"));
    } finally {
      setDeploying(false);
    }
  };

  const onDisconnect = async () => {
    if (!window.confirm(t("confirmDisconnect", { provider: label }))) return;
    try {
      await fetch(`/api/integrations/${provider}`, { method: "DELETE" });
      setError(null);
      await refresh();
    } catch {
      setError(t("errors.network"));
    }
  };

  const trapRef = useFocusTrap(open);

  if (!open) return null;

  const title =
    provider === "vercel" ? t("header.titleVercel") : t("header.titleGithub");
  const subtitle =
    provider === "vercel"
      ? t("header.subtitleVercel")
      : t("header.subtitleGithub");
  const nameHint =
    provider === "vercel"
      ? t("connected.nameHintVercel")
      : t("connected.nameHintGithub");
  const nameValid = NAME_RE.test(name.trim().toLowerCase());
  const connected = !!status?.connected;
  const configured = status ? status.configured : true;

  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-elev border bd shadow-elev">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b bd bg-elev rounded-t-2xl">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[var(--accent)]">
              {provider === "github" ? (
                <GitBranch size={14} />
              ) : (
                <Triangle size={13} className="fill-current" />
              )}
            </span>
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight fg">
                {title}
              </h2>
              <p className="text-[11px] fg-faint">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover transition fg-muted"
            aria-label={t("close")}
          >
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

          {loading && !status ? (
            <div className="flex items-center gap-2 text-[12px] fg-faint py-4">
              <Loader2 size={14} className="animate-spin" />
              {t("connect.redirecting")}
            </div>
          ) : !configured ? (
            <div className="rounded-lg ring-1 ring-[color:var(--border)] bg-app p-4">
              <div className="text-[13px] font-semibold fg">
                {t("notConfigured.title")}
              </div>
              <p className="mt-1 text-[12px] fg-faint">
                {t("notConfigured.body")}
              </p>
            </div>
          ) : !connected ? (
            <div className="space-y-3">
              <p className="text-[12.5px] fg-muted">
                {t("connect.lead", { provider: label })}
              </p>
              <button
                type="button"
                onClick={onConnect}
                disabled={connecting}
                className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md bg-[var(--accent-strong)] text-white text-[12.5px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connecting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : provider === "github" ? (
                  <GitBranch size={13} />
                ) : (
                  <Triangle size={12} className="fill-current" />
                )}
                {connecting
                  ? t("connect.redirecting")
                  : t("connect.button", { provider: label })}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-[11.5px] text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={12} />
                <span>
                  {status?.accountLabel
                    ? t("connected.as", { account: status.accountLabel })
                    : t("connected.asAnon")}
                </span>
              </div>

              <div>
                <label className="block text-[11.5px] font-medium fg mb-1.5">
                  {t("connected.nameLabel")}
                </label>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value.toLowerCase().replace(/\s+/g, "-"));
                    setJustDeployed(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !deploying && nameValid) onDeploy();
                  }}
                  className="w-full h-9 px-3 rounded-md ring-1 ring-[color:var(--border)] bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)] transition"
                />
                <p className="mt-1 text-[10.5px] fg-faint">{nameHint}</p>
              </div>

              {status?.liveUrl && (
                <div className="rounded-md ring-1 ring-emerald-200 dark:ring-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 text-[11.5px] font-mono text-emerald-800 dark:text-emerald-300 truncate">
                      {status.liveUrl.replace(/^https?:\/\//, "")}
                    </span>
                    <a
                      href={status.liveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 transition shrink-0"
                    >
                      <ExternalLink size={10} /> {t("connected.open")}
                    </a>
                  </div>
                  <div className="mt-1 text-[10.5px] text-emerald-700/80 dark:text-emerald-300/80">
                    {status.hasUnpublishedChanges
                      ? t("connected.drift")
                      : t("connected.upToDate")}
                  </div>
                </div>
              )}

              {justDeployed && (
                <div className="flex items-start gap-2 rounded-md ring-1 ring-amber-200 dark:ring-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-200">
                  <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
                  <span>{t("connected.publishing")}</span>
                </div>
              )}

              {provider === "github" && !justDeployed && (
                <p className="text-[10.5px] fg-faint">
                  {t("connected.propagation")}
                </p>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={onDeploy}
                  disabled={deploying || !nameValid}
                  className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md bg-[var(--accent-strong)] text-white text-[12.5px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deploying ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Rocket size={13} />
                  )}
                  {deploying
                    ? t("connected.deploying")
                    : status?.liveUrl
                      ? t("connected.redeploy")
                      : t("connected.deploy")}
                </button>
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-medium fg-muted hover:bg-hover transition"
                >
                  <Unplug size={12} /> {t("connected.disconnect")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
