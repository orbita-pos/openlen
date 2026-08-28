"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, ExternalLink, Globe, Loader } from "./icons";
import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";
import { PUBLISHED_BASE_HOST } from "@/lib/publish/base-host";

// The publish gate (Task 7). The agent NEVER publishes — it emits a `confirm`
// SSE event, the chat panel renders THIS card, and only the user's tap on
// «Publicar» hits the real endpoint. Everything below is client-side: a check
// (for a new claim) then the publish POST. The card is one-shot: after a
// successful publish or a cancel it goes inert.

export interface AgentConfirm {
  action: "publicar";
  subdominio: string;
  idiomas: string[];
  republicar: boolean;
}

type CardState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "publishing" }
  // `langsFallidos`: idiomas que el usuario pidió y que NO salieron. La
  // publicación es un éxito de todas formas —la raíz está online— pero
  // callarlo es lo que dejó la traducción rota cinco meses sin que nadie lo
  // supiera.
  | { kind: "published"; url: string; langsFallidos: string[] }
  | { kind: "cancelled" }
  | { kind: "error"; text: string };

const BASE_HOST = PUBLISHED_BASE_HOST;

export function AgentConfirmCard({
  projectId,
  confirm,
  onPublished,
}: {
  projectId: string;
  confirm: AgentConfirm;
  onPublished: (url: string) => void;
}) {
  const t = useTranslations("wsPage");
  const [state, setState] = useState<CardState>({ kind: "idle" });

  const busy = state.kind === "checking" || state.kind === "publishing";
  const inert = state.kind === "published" || state.kind === "cancelled";

  const handlePublish = useCallback(async () => {
    if (busy || inert) return;
    const { subdominio, idiomas, republicar } = confirm;

    // Claim-new path mirrors the PublishModal: an availability check first, and
    // only proceed when the name is actually free. Re-publishing the current
    // claim skips the check (same as the modal).
    if (!republicar) {
      setState({ kind: "checking" });
      try {
        const res = await fetch("/api/subdomains/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain: subdominio }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          available?: boolean;
          reason?: string;
        };
        if (!res.ok || !data.available) {
          setState({
            kind: "error",
            text:
              data.reason === "taken"
                ? t("agent.confirm.taken")
                : data.reason === "limit_reached"
                  ? t("agent.confirm.limit")
                  : data.reason === "reserved"
                    ? t("agent.confirm.reserved")
                    : t("agent.confirm.invalid"),
          });
          return;
        }
      } catch {
        setState({ kind: "error", text: t("agent.confirm.invalid") });
        return;
      }
    }

    setState({ kind: "publishing" });
    try {
      // `languages` is only sent when the agent actually chose some: the
      // endpoint treats a PRESENT key as "persist this" (an [] would wipe a
      // live site's stored translations on a plain republish), while an
      // OMITTED key keeps the stored setting. Consequence: the agent can
      // add/set languages but never clear them — clearing is the publish
      // modal's job.
      const res = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain: subdominio,
          ...(idiomas.length > 0 ? { languages: idiomas } : {}),
        }),
      });
      if (!res.ok) {
        // The endpoint is the final authority — map its status codes to text.
        setState({
          kind: "error",
          text:
            res.status === 402
              ? t("agent.confirm.limit")
              : res.status === 409
                ? t("agent.confirm.taken")
                : t("agent.confirm.invalid"),
        });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        localesFallidos?: string[];
      };
      const url = data.url ?? `https://${subdominio}.${BASE_HOST}`;
      setState({ kind: "published", url, langsFallidos: data.localesFallidos ?? [] });
      onPublished(url);
    } catch {
      setState({ kind: "error", text: t("agent.confirm.invalid") });
    }
  }, [busy, inert, confirm, projectId, t, onPublished]);

  const handleCancel = useCallback(() => {
    if (busy || inert) return;
    setState({ kind: "cancelled" });
  }, [busy, inert]);

  if (state.kind === "published") {
    return (
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-500/10 px-3 py-2.5 text-[11.5px]">
        <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
          <Check size={14} className="shrink-0" />
          <span>{t("agent.confirm.published", { url: hostOf(state.url) })}</span>
        </div>
        {state.langsFallidos.length > 0 && (
          <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              {t("agent.confirm.langsFailed", {
                langs: state.langsFallidos
                  .map((c) => PUBLISH_LOCALES.find((l) => l.code === c)?.name ?? c)
                  .join(", "),
              })}
            </span>
          </div>
        )}
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline break-all"
        >
          {state.url}
          <ExternalLink size={10} className="shrink-0" />
        </a>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border bd bg-app px-3 py-2.5 ${
        state.kind === "cancelled" ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-[12px] font-medium fg">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Globe size={13} />
        </span>
        <span>{t("agent.confirm.publishTitle")}</span>
      </div>

      <div className="mt-2 rounded-md bg-elev border bd px-2.5 py-1.5 text-[12px] font-mono fg break-all">
        <span className="fg">{confirm.subdominio}</span>
        <span className="fg-faint">.{BASE_HOST}</span>
      </div>

      {confirm.idiomas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {confirm.idiomas.map((code) => (
            <span
              key={code}
              className="inline-flex items-center h-5 px-1.5 rounded-full text-[10px] font-medium bg-accent-soft text-accent uppercase"
            >
              {code}
            </span>
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">
          {state.text}
        </div>
      )}

      {state.kind !== "cancelled" && (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePublish()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] font-medium bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? (
              <>
                <Loader size={12} className="animate-spin" />
                <span>
                  {state.kind === "checking"
                    ? t("agent.confirm.checking")
                    : t("agent.confirm.publish")}
                </span>
              </>
            ) : (
              t("agent.confirm.publish")
            )}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="h-7 px-2.5 rounded-md text-[11.5px] font-medium fg-faint hover:fg hover:bg-hover transition disabled:opacity-50"
          >
            {t("agent.confirm.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Strip the scheme for the success line so it reads "…openlen.com" not the
 *  full https:// (the link below carries the clickable full URL). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
