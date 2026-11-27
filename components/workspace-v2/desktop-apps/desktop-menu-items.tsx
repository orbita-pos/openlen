"use client";

// THE ENTRIES OF THE MENU (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.6): «Instalar en el escritorio»; once it is
// installed, «Actualizar en el escritorio» only when there is something new (Claude has no «update» action when nothing changed:
// otherwise the entry reads «Abrir en el escritorio» and opens the window); and «Quitar del escritorio». They live in the
// Publicar menu of an app and in the install menu of a tool, which is why they are one component. The owner only, and only with
// the switch on: the route answers a 404 otherwise and the entries are not drawn (see `use-desktop-app.ts`).
//
// An entry the route knows can't be used (the plan, Stripe, a tool that isn't installed) is drawn all the same — disabled, with
// its reason where the subtitle goes — so the person reads why before any tap (Claude offers install only where it can work).
import { ChevronRight, MonitorDown, MonitorUp, MonitorX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { forgetGrantedOf } from "@/lib/desktop-apps/permissions/grants";

import { DesktopInstallCard } from "./desktop-install-card";
import { desktopRoute, useDesktopApp } from "./use-desktop-app";

const ENTRY =
  "flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-md hover:bg-hover transition group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent";
const ICON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[var(--accent)]";

export function DesktopMenuItems({
  projectId,
  title,
  className,
  onCardChange,
}: {
  projectId: string;
  title: string;
  className?: string;
  /** Told whenever the install card opens or closes: a menu that holds another install card (a tool's own) shows one at a time. */
  onCardChange?: (open: boolean) => void;
}) {
  const t = useTranslations("panelsChat");
  const { state, reload } = useDesktopApp(projectId, true);
  // What the card was opened for, kept: it goes on saying «Instalada» after the state moves on to «installed».
  const [card, setCard] = useState<{ update: boolean } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);

  const cardOpen = card !== null;
  useEffect(() => {
    onCardChange?.(cardOpen);
  }, [cardOpen, onCardChange]);

  if (!state) return null;
  const desktopApp = state.desktopApp;
  const installed = desktopApp !== null;
  const blocked = state.blockedBy;

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setRemoveFailed(false);
    try {
      const res = await fetch(desktopRoute(projectId), { method: "DELETE" });
      if (res.ok) {
        // Its «yes» answers in this browser go with it, its «no» stay (spec local 2026-11-27-notificaciones-del-escritorio,
        // §4.4, like Claude); a reinstall's new `installedAt` voids the «yes» on every other device.
        if (desktopApp) forgetGrantedOf(desktopApp.id);
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

  // «Instalar» / «Actualizar»: one entry that opens the card, or the same entry disabled with its reason.
  const doEntry = (update: boolean) => (
    <button type="button" disabled={blocked !== null} onClick={() => setCard({ update })} className={ENTRY}>
      <span className={ICON}>
        <MonitorDown size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold tracking-tight fg">{t(update ? "desktopInstall.menu.update" : "desktopInstall.menu.install")}</span>
        <span className="block text-[11px] fg-faint">
          {blocked ? t(`desktopInstall.menu.blocked.${blocked}`) : t(update ? "desktopInstall.menu.updateAvailable" : "desktopInstall.menu.installSubtitle")}
        </span>
      </span>
      {blocked ? null : <ChevronRight size={12} className="fg-faint group-hover:text-[var(--accent)] transition" />}
    </button>
  );

  return (
    <div data-desktop-menu className={className}>
      {card ? (
        <>
          {/* A menu shared with another install card shows one at a time: this is the way back to the other. */}
          {onCardChange ? (
            <button type="button" onClick={() => setCard(null)} className="mb-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] fg-muted hover:bg-hover">
              <ChevronRight size={11} className="rotate-180" />
              {t("desktopInstall.menu.back")}
            </button>
          ) : null}
          <DesktopInstallCard
            projectId={projectId}
            title={title}
            published={state.published}
            update={card.update}
            onInstalled={reload}
            onCancelled={() => setCard(null)}
          />
        </>
      ) : !installed ? (
        doEntry(false)
      ) : state.updateAvailable ? (
        doEntry(true)
      ) : (
        <a href={desktopApp.url} target="_blank" rel="noopener noreferrer" className={ENTRY}>
          <span className={ICON}>
            <MonitorUp size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold tracking-tight fg">{t("desktopInstall.menu.open")}</span>
            <span className="block text-[11px] fg-faint">{t("desktopInstall.menu.upToDate")}</span>
          </span>
          <ChevronRight size={12} className="fg-faint group-hover:text-[var(--accent)] transition" />
        </a>
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
