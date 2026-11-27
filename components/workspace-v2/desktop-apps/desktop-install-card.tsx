"use client";

// «INSTALAR EN EL ESCRITORIO» (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §5): the card of a tool's install, pointed
// at the desktop route. It runs the same gates and asks the same questions (the security review's findings, data that would
// be destroyed) — the tap on it is the approval. When it goes through it opens the window of the installation in a tab, which
// is where the browser offers to install it.
import { useTranslations } from "next-intl";
import { useState } from "react";

import { InstallConfirmCard } from "../tools/install-confirm-card";
import { desktopRoute } from "./use-desktop-app";

// The codes of the route that mean something to the person (the gates' own — a failing build, a pending review — the card
// already knows). Anything else shows as the code, as a tool's install does.
const REASON_CODES = ["plan_required", "uses_stripe", "tool_not_installed", "owner_only", "not_an_app", "desktop_apps_off"] as const;

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
  const [url, setUrl] = useState<string | null>(null);

  const reasons: Record<string, string> = {};
  for (const code of REASON_CODES) reasons[code] = t(`desktopInstall.reasons.${code}`);

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
        reasons={reasons}
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
