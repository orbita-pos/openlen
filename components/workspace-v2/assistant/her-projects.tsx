"use client";

// HER PROJECTS, IN HER PLACE (spec local 2026-11-06-asistente-propio, §4.5, §4.6.2): where «En mi página» was. Her home's
// switch stays in the header, as before; a button with how many projects she serves opens a panel with each one — its
// name and address, «Su casa» on hers, its own «En mi página», and «Quitar de este proyecto» (never on her only
// one) — and, at its foot, «Borrar a Lucía». Removing and deleting ask first.
import { ChevronRight, FolderClosed } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { HER_ROW } from "./her-sheet";
import { OnPageSwitch } from "./on-page-switch";

interface Row {
  readonly projectId: string;
  readonly title: string | null;
  readonly address: string | null;
  readonly isHome: boolean;
  readonly onPage: boolean;
  readonly needsPublish: boolean;
  readonly nothingToKnow: boolean;
  /** She knows what it published (a publish since she serves it). */
  readonly knowsIt?: boolean;
}

/** One of the person's own pages, from GET /api/projects (the space is never among them). */
interface TheirPage {
  readonly id: string;
  readonly title: string | null;
  readonly isBlank?: boolean;
}

export function HerProjects({
  assistantId,
  name,
  homeOnPage,
  homeNeedsPublish,
  homeNothingToKnow,
  inSpace = false,
  leave = (href: string) => window.location.assign(href),
}: {
  assistantId: string;
  name: string;
  homeOnPage: boolean;
  homeNeedsPublish: boolean;
  homeNothingToKnow: boolean;
  /** She lives in the person's space (spec local 2026-11-19-agentes-para-todos, §6.2): no home page, no home switch; her
   *  pages are only the ones she attends, and she can leave any of them. */
  inSpace?: boolean;
  /** Where the page goes after deleting her (tests watch it). */
  leave?: (href: string) => void;
}) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"failed" | "busy" | null>(null);
  // «Atender una página» (spec local 2026-11-19-agentes-para-todos, §6.7): the person's pages she doesn't attend, and the
  // one a page already has, asked about before she takes its place.
  const [pages, setPages] = useState<readonly TheirPage[] | null>(null);
  const [asking, setAsking] = useState<{ readonly page: TheirPage; readonly current: string } | null>(null);
  const [attendBusy, setAttendBusy] = useState<string | null>(null);
  const base = `/api/assistants/${encodeURIComponent(assistantId)}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/projects`);
      if (!res.ok) return;
      setRows(((await res.json()) as { projects?: Row[] }).projects ?? []);
    } catch {
      // Her home's switch still works; the list loads next time.
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (row: Row) => {
    setBusy(true);
    setFailed(null);
    const res = await fetch(`${base}/projects/${encodeURIComponent(row.projectId)}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setRemoving(null);
    if (!res?.ok) {
      const body = ((await res?.json().catch(() => null)) ?? {}) as { error?: string };
      return setFailed(body.error === "busy" ? "busy" : "failed");
    }
    // Off her home, her home and her conversation moved: this page shows another project's now.
    if (row.isHome) return leave(window.location.href);
    await load();
  };

  const openPages = async () => {
    setFailed(null);
    setAttendBusy(null);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) return setFailed("failed");
      setPages(((await res.json()) as { projects?: TheirPage[] }).projects?.filter((p) => !p.isBlank) ?? []);
    } catch {
      setFailed("failed");
    }
  };

  // Turning her bubble on is the person's act here: they chose the page for her.
  const attend = async (page: TheirPage, replace = false) => {
    setBusy(true);
    setFailed(null);
    setAttendBusy(null);
    const res = await fetch(`${base}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: page.id, onPage: true, ...(replace ? { replace: true } : {}) }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setPages(null);
      setAsking(null);
      return load();
    }
    const body = ((await res?.json().catch(() => null)) ?? {}) as { error?: string; current?: { name?: string } };
    if (body.error === "project_has_assistant" && body.current?.name) return setAsking({ page, current: body.current.name });
    if (body.error === "busy" && asking) return setAttendBusy(asking.current);
    setFailed("failed");
  };

  const deleteHer = async () => {
    setBusy(true);
    setFailed(null);
    const res = await fetch(base, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setFailed("failed");
    leave(`/${locale}/projects`);
  };

  // An assistant of before always serves her home; one of the space may attend none.
  const count = inSpace ? (rows?.length ?? 0) : rows?.length || 1;
  const served = new Set((rows ?? []).map((r) => r.projectId));
  const free = (pages ?? []).filter((p) => !served.has(p.id));
  const ghost = "rounded-full border bd px-2.5 py-1 text-[11.5px] font-medium fg-muted hover:fg disabled:opacity-50";

  return (
    <div className="relative flex min-w-0 flex-col">
      {!inSpace && (
        <>
          <div className="flex px-2.5 py-[7px]" data-her-home-switch="">
            <OnPageSwitch assistantId={assistantId} initial={homeOnPage} initialNeedsPublish={homeNeedsPublish} nothingToKnow={homeNothingToKnow} />
          </div>
          <div className="my-1 h-px bg-[var(--border)]" />
        </>
      )}
      <button type="button" data-her-projects-open="" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={HER_ROW}>
        <FolderClosed size={15} strokeWidth={1.8} className="shrink-0 fg-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t("ownAssistant.projects.count", { count })}</span>
        <ChevronRight size={14} className={`shrink-0 fg-faint transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("ownAssistant.projects.count", { count })}
          data-her-projects=""
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          className="mt-1 flex flex-col gap-2 rounded-[10px] bg-side p-2"
        >
          {(rows ?? []).map((row) => (
            <div key={row.projectId} data-her-project={row.projectId} className="flex flex-col gap-1.5 rounded-lg border bd px-2.5 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium fg">{row.title || row.projectId}</p>
                  {row.address && <p className="truncate text-[11.5px] fg-faint">{row.address}</p>}
                </div>
                {row.isHome && <span className="shrink-0 rounded-full bg-hover px-2 py-0.5 text-[11px] fg-muted">{t("ownAssistant.projects.home")}</span>}
              </div>
              {/* Published before she served it: she learns it at its next publish (final review I2). */}
              {row.knowsIt === false && row.address && <p className="text-[11.5px] fg-faint">{t("ownAssistant.projects.publishToKnow", { name })}</p>}
              {/* Her home's switch is the one in the header. */}
              {!row.isHome && (
                <OnPageSwitch assistantId={assistantId} projectId={row.projectId} initial={row.onPage} initialNeedsPublish={row.needsPublish} nothingToKnow={row.nothingToKnow} />
              )}
              {(inSpace || (rows ?? []).length > 1) &&
                (removing === row.projectId ? (
                  <button type="button" data-her-project-remove-confirm="" disabled={busy} onClick={() => void remove(row)} className={`${ghost} self-start text-[var(--nc-danger,#c2410c)]`}>
                    {t("ownAssistant.projects.removeConfirm")}
                  </button>
                ) : (
                  <button type="button" data-her-project-remove="" disabled={busy} onClick={() => setRemoving(row.projectId)} className={`${ghost} self-start`}>
                    {t("ownAssistant.projects.remove")}
                  </button>
                ))}
            </div>
          ))}
          {/* «Atender una página»: one of the person's pages she doesn't attend; one that has another asks first. */}
          {asking ? (
            <div data-her-attend-ask="" className="flex flex-col gap-1.5 rounded-lg border bd px-2.5 py-2">
              <p className="text-[12.5px] fg">{t("ownAssistant.projects.attendReplace", { current: asking.current, name })}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-her-attend-replace="" disabled={busy} onClick={() => void attend(asking.page, true)} className={ghost}>
                  {t("ownAssistant.projects.attendReplaceYes")}
                </button>
                <button type="button" disabled={busy} onClick={() => setAsking(null)} className={ghost}>
                  {t("ownAssistant.projects.attendKeep")}
                </button>
              </div>
              {attendBusy && (
                <p role="alert" className="text-[12px] nc-bad">
                  {t("ownAssistant.projects.attendBusy", { current: attendBusy })}
                </p>
              )}
            </div>
          ) : pages ? (
            <div data-her-attend-list="" className="flex flex-col gap-1">
              {free.length === 0 ? (
                <p className="px-1 text-[12px] fg-faint">{t("ownAssistant.projects.attendNone")}</p>
              ) : (
                free.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    data-her-attend-page={page.id}
                    disabled={busy}
                    onClick={() => void attend(page)}
                    className="truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px] fg hover:bg-hover disabled:opacity-50"
                  >
                    {page.title || page.id}
                  </button>
                ))
              )}
            </div>
          ) : (
            <button type="button" data-her-attend="" disabled={busy} onClick={() => void openPages()} className={`${ghost} self-start`}>
              {t("ownAssistant.projects.attend")}
            </button>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t bd pt-2">
            {deleting ? (
              <button type="button" data-her-delete-confirm="" disabled={busy} onClick={() => void deleteHer()} className={`${ghost} text-[var(--nc-danger,#c2410c)]`}>
                {t("ownAssistant.projects.deleteConfirm", { name })}
              </button>
            ) : (
              <button type="button" data-her-delete="" disabled={busy} onClick={() => setDeleting(true)} className={ghost}>
                {t("ownAssistant.projects.delete", { name })}
              </button>
            )}
            <button type="button" onClick={() => (setOpen(false), setDeleting(false), setRemoving(null), setPages(null), setAsking(null))} className="ml-auto text-[11.5px] fg-muted hover:fg">
              {t("ownAssistant.projects.close")}
            </button>
          </div>
          {failed && (
            <p role="alert" className="text-[12px] nc-bad">
              {failed === "busy" ? t("ownAssistant.projects.busy", { name }) : t("ownAssistant.projects.failed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
