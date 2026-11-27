"use client";

// «INSTALAR EN EL ESCRITORIO» (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §5): the card of a tool's install, pointed
// at the desktop route. It runs the same gates and asks the same questions (the security review's findings, data that would
// be destroyed) — the tap on it is the approval. When it goes through it opens the window of the installation in a tab, which
// is where the browser offers to install it. When it doesn't, it says so as Claude does: «Couldn't install {app}» and, on
// its own line, why — with the one action that fixes it when there is one.
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { failureAction, failureOf, type DesktopFailure } from "@/lib/desktop-apps/failure";

import { InstallConfirmCard } from "../tools/install-confirm-card";
import { desktopRoute } from "./use-desktop-app";

// The reasons the card has words for. The gates' questions (a finding, a data change) are the card's own states, and a window
// that was removed elsewhere is the window's: anything else that reaches here is the generic «try again».
const CARD_REASONS: ReadonlySet<DesktopFailure> = new Set([
  "plan_required",
  "owner_only",
  "not_an_app",
  "uses_stripe",
  "tool_not_installed",
  "desktop_apps_off",
  "securityPending",
  "problem",
  "failed",
]);

export function DesktopInstallCard({
  projectId,
  title,
  published,
  update,
  onInstalled,
  onCancelled,
}: {
  projectId: string;
  title: string;
  /** The project has a published site: it shares its production data with this app (spec §5), and the card says so. */
  published: boolean;
  /** The person already has it installed: this is the update (same gates, same route). */
  update: boolean;
  onInstalled?: () => void;
  onCancelled?: () => void;
}) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [url, setUrl] = useState<string | null>(null);

  const links = { pricing: `/${locale}/pricing`, tools: `/${locale}/new?view=tools` } as const;

  return (
    <>
      <InstallConfirmCard
        projectId={projectId}
        endpoint={desktopRoute(projectId)}
        install={{ title }}
        notice={published ? t("desktopInstall.sharedWithSite") : undefined}
        labels={{
          title: t(update ? "desktopInstall.updateTitle" : "desktopInstall.title", { title }),
          install: t(update ? "desktopInstall.update" : "desktopInstall.install"),
          installed: t(update ? "desktopInstall.updated" : "desktopInstall.installed"),
        }}
        failure={({ code, status }) => {
          const failure = failureOf(status, code);
          const action = failureAction(failure);
          return (
            <div className="mt-2" role="alert" data-desktop-failure={failure}>
              <p className="text-[12px] font-medium text-[var(--nc-warn)]" data-desktop-failure-title>
                {t(update ? "desktopInstall.failed.update" : "desktopInstall.failed.install", { title })}
              </p>
              <p className="mt-0.5 text-[12px] fg-muted" data-desktop-failure-reason>
                {t(`desktopInstall.reasons.${CARD_REASONS.has(failure) ? failure : "failed"}`)}
              </p>
              {/* The «project» action is the window's (the gates' dialogs are right here); only plans and Tools are other places. */}
              {action === "pricing" || action === "tools" ? (
                <a href={links[action]} target="_blank" rel="noopener" className="mt-1 inline-block text-[12px] text-[var(--accent)] hover:underline">
                  {t(`desktopInstall.actions.${action}`)}
                </a>
              ) : null}
            </div>
          );
        }}
        onInstalled={() => onInstalled?.()}
        onResult={(data) => {
          const app = data.desktopApp as { url?: unknown } | null | undefined;
          if (typeof app?.url !== "string") return;
          setUrl(app.url);
          window.open(app.url, "_blank");
        }}
        onCancelled={onCancelled}
      />
      {/* The tab opens after a request that may have taken longer than a click lasts, and a pop-up blocker can stop it:
          the address stays here. */}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[12px] text-[var(--accent)] hover:underline">
          {t("desktopInstall.open")}
        </a>
      ) : null}
    </>
  );
}
