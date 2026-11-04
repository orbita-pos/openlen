"use client";

// THE «INSTALAR» CARD (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): what Len's `publish` leaves in a tool
// project, the same mechanism as the publish card. Nothing is installed until the person taps «Instalar»; the route
// runs the same gates as publishing. Findings of the security review are the person's to accept («Instalar
// igual»), as are destructive data changes; Len can accept neither.
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { postInstallAfterSecurity, type PublishOutcome } from "@/lib/workspace-v2/publish-request";
import type { ToolInstallConfirm } from "@/lib/agent/tool-install";

import { announceToolsChanged } from "./use-installed-tools";

type CardState =
  | { kind: "idle" }
  | { kind: "installing" }
  | { kind: "security_findings"; fingerprint: string; titles: string[] }
  | { kind: "needs_confirmation"; fingerprint: string }
  | { kind: "installed" }
  | { kind: "cancelled" }
  | { kind: "error"; text: string };

export function InstallConfirmCard({
  projectId,
  install,
  onInstalled,
  onCancelled,
}: {
  projectId: string;
  install: ToolInstallConfirm;
  onInstalled: (title: string) => void;
  onCancelled?: () => void;
}) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [state, setState] = useState<CardState>({ kind: "idle" });
  const accepted = useRef<{ acceptSecurityFingerprint?: string; confirmFingerprint?: string }>({});

  async function run(extra: { acceptSecurityFingerprint?: string; confirmFingerprint?: string } = {}) {
    accepted.current = { ...accepted.current, ...extra };
    setState({ kind: "installing" });
    const outcome: PublishOutcome = await postInstallAfterSecurity(projectId, { locale, ...accepted.current }, () => {}).catch(
      () => ({ kind: "error", status: 0, error: "network" }) as PublishOutcome,
    );
    if (outcome.kind === "published") {
      setState({ kind: "installed" });
      announceToolsChanged();
      onInstalled(install.title);
    } else if (outcome.kind === "security_findings") {
      setState({ kind: "security_findings", fingerprint: outcome.view.fingerprint, titles: outcome.view.blocking.map((f) => f.description || f.category) });
    } else if (outcome.kind === "needs_confirmation") {
      setState({ kind: "needs_confirmation", fingerprint: outcome.fingerprint });
    } else {
      setState({ kind: "error", text: outcome.kind === "error" ? outcome.error : outcome.kind });
    }
  }

  const inert = state.kind === "installed" || state.kind === "cancelled";
  return (
    <div className="mt-2 rounded-xl border bd bg-elev px-3 py-2.5" data-install-card={state.kind}>
      <p className="text-[13px] font-semibold fg">{t("installCard.title", { title: install.title })}</p>
      <p className="mt-0.5 text-[12px] fg-muted">{install.placement === "rail" ? t("installCard.inRail") : t("installCard.inProject")}</p>
      {state.kind === "security_findings" ? (
        <div className="mt-2 rounded-lg bg-[var(--hover)] px-2.5 py-1.5 text-[12px] fg">
          <p className="font-medium">{t("installCard.findings")}</p>
          <ul className="mt-1 list-disc pl-4">
            {state.titles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.kind === "needs_confirmation" ? <p className="mt-2 text-[12px] text-[var(--nc-warn)]">{t("installCard.destructive")}</p> : null}
      {state.kind === "error" ? <p className="mt-2 text-[12px] text-[var(--nc-warn)]">{t("installCard.failed", { reason: state.text })}</p> : null}
      {state.kind === "installed" ? <p className="mt-2 text-[12px] text-[var(--nc-ok)]">{t("installCard.installed")}</p> : null}
      {!inert ? (
        <div className="mt-2.5 flex gap-2">
          {state.kind === "security_findings" ? (
            <button type="button" onClick={() => void run({ acceptSecurityFingerprint: state.fingerprint })} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-medium text-white">
              {t("installCard.installAnyway")}
            </button>
          ) : state.kind === "needs_confirmation" ? (
            <button type="button" onClick={() => void run({ confirmFingerprint: state.fingerprint })} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-medium text-white">
              {t("installCard.installAnyway")}
            </button>
          ) : (
            <button type="button" disabled={state.kind === "installing"} onClick={() => void run()} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60">
              {t("installCard.install")}
            </button>
          )}
          <button
            type="button"
            disabled={state.kind === "installing"}
            onClick={() => {
              setState({ kind: "cancelled" });
              onCancelled?.();
            }}
            className="rounded-md px-3 py-1.5 text-[12.5px] fg-muted hover:bg-hover"
          >
            {t("installCard.cancel")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
