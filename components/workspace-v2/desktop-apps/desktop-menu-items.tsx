"use client";

// THE ENTRIES OF THE MENU (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.6): «Instalar en el escritorio» — or
// «Actualizar en el escritorio» once it is installed — and «Quitar del escritorio». They live in the Publicar menu of an app
// and in the install menu of a tool, which is why they are one component. The owner only, and only with the switch on: the
// route answers a 404 otherwise and the entries are not drawn (see `use-desktop-app.ts`).
import { ChevronRight, MonitorDown, MonitorX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { DesktopInstallCard } from "./desktop-install-card";
import { desktopRoute, useDesktopApp } from "./use-desktop-app";

const ENTRY =
  "flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-md hover:bg-hover transition group disabled:opacity-50 disabled:cursor-not-allowed";
const ICON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[var(--accent)]";

export function DesktopMenuItems({ projectId, title, className }: { projectId: string; title: string; className?: string }) {
  const t = useTranslations("panelsChat");
  const { state, reload } = useDesktopApp(projectId, true);
  // What the card was opened for, kept: it goes on saying «Instalada» after the state moves on to «installed».
  const [card, setCard] = useState<{ update: boolean } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);

  if (!state) return null;
  const installed = state.desktopApp !== null;

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setRemoveFailed(false);
    try {
      const res = await fetch(desktopRoute(projectId), { method: "DELETE" });
      if (res.ok) {
        setCard(null);
        reload();
      } else {
        setRemoveFailed(true);
      }
    } catch {
      setRemoveFailed(true);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div data-desktop-menu className={className}>
      {card ? (
        <DesktopInstallCard
          projectId={projectId}
          title={title}
          published={state.published}
          update={card.update}
          onInstalled={reload}
          onCancelled={() => setCard(null)}
        />
      ) : (
        <button type="button" onClick={() => setCard({ update: installed })} className={ENTRY}>
          <span className={ICON}>
            <MonitorDown size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold tracking-tight fg">{t(installed ? "desktopInstall.menu.update" : "desktopInstall.menu.install")}</span>
            <span className="block text-[11px] fg-faint">
              {t(!installed ? "desktopInstall.menu.installSubtitle" : state.updateAvailable ? "desktopInstall.menu.updateAvailable" : "desktopInstall.menu.upToDate")}
            </span>
          </span>
          <ChevronRight size={12} className="fg-faint group-hover:text-[var(--accent)] transition" />
        </button>
      )}
      {installed ? (
        <button type="button" disabled={removing} onClick={() => void remove()} className={ENTRY}>
          <span className={ICON}>
            <MonitorX size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold tracking-tight fg">{t("desktopInstall.menu.remove")}</span>
            <span className="block text-[11px] fg-faint">{t("desktopInstall.menu.removeSubtitle")}</span>
          </span>
        </button>
      ) : null}
      {removeFailed ? <p className="px-2.5 py-1 text-[11px] text-[var(--nc-warn)]">{t("desktopInstall.menu.removeFailed")}</p> : null}
    </div>
  );
}
