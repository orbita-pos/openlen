"use client";

// «TEMAS» ON THE HERRAMIENTAS PAGE (spec local 2026-11-27-temas-del-workspace, §4.4): Claude Code's `/custom-theme` as a
// picker. A card per theme the person can use — the gallery that comes with OpenLen and the theme projects they
// installed — grouped by the window it paints (light or dark), each with its still picture, its twin, and:
//   · «Vista previa»: shows it in THIS TAB only, kept in memory (`previewWorkspaceTheme`); nothing is saved, and it ends
//     on «Dejar de ver», on any pick, or when the person leaves the page — it must not stay on with no button to stop it.
//   · «Usar en todo» / «Usar en este proyecto» (only with a project open): `PUT /api/themes`, which says who may pick what.
//   · «Desactivar»: clears the pick this card holds (the project's, everywhere's, or both) — never another card's.
//   · «Quitar», for a theme the person installed: removes the installation (`DELETE /api/projects/<theme project>/theme-install`).
// «Nuevo tema» is the Tool button's twin: a blank project born as a theme, from the home's box.
// With themes off the server answers 404 and none of this is drawn.
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { useWorkspaceTheme } from "@/components/workspace-v2/theme/use-workspace-theme";
import type { AvailableTheme } from "@/lib/themes/resolve";
import type { ThemeChoices } from "@/lib/themes/types";

import { homeHref } from "../chat/nace-como";

interface View {
  applied: ThemeChoices;
  available: AvailableTheme[];
}

const JSON_HEADERS = { "content-type": "application/json" };

/** What `GET /api/themes` says for this person and project; null when themes are off (404), signed out or unreachable. */
async function readView(projectId: string | null, locale: string): Promise<View | null> {
  const query = new URLSearchParams();
  if (projectId) query.set("project", projectId);
  query.set("locale", locale);
  try {
    const res = await fetch(`/api/themes?${query.toString()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<View>;
    return Array.isArray(body.available) ? { applied: body.applied ?? { everywhere: null, project: null }, available: body.available } : null;
  } catch {
    return null;
  }
}

export function ThemesSection({ projectId }: { projectId: string | null }) {
  const t = useTranslations("wsChrome");
  const locale = useLocale();
  const router = useRouter();
  const { previewing, preview, reload } = useWorkspaceTheme(projectId);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void readView(projectId, locale).then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, [projectId, locale]);

  // A preview is this tab's and lives in memory: leaving the page ends it.
  useEffect(() => () => preview(null), [preview]);

  const save = useCallback(
    (scope: "everywhere" | "project", themeRef: string | null) =>
      fetch("/api/themes", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify(scope === "everywhere" ? { scope, themeRef } : { scope, projectId, themeRef }),
      }),
    [projectId],
  );

  /** Runs the requests of one button in order, stopping at the first that fails, then reads everything again. */
  async function run(key: string, steps: Array<() => Promise<Response>>, endsPreview: boolean) {
    setBusy(key);
    setFailed(false);
    let done = 0;
    try {
      for (const step of steps) {
        const res = await step();
        if (!res.ok) {
          setFailed(true);
          break;
        }
        done += 1;
      }
    } catch {
      setFailed(true);
    }
    if (done > 0) {
      // What was only previewed is now the pick (or no longer there): the layer shows what is saved.
      if (endsPreview) preview(null);
      reload();
    }
    setView(await readView(projectId, locale));
    setBusy(null);
  }

  if (!view) return null;

  const titleOf = (ref: string) => view.available.find((a) => a.ref === ref)?.title;
  const groups = [
    { window: "light" as const, heading: t("themes.lightWindow"), cards: view.available.filter((a) => a.window === "light") },
    { window: "dark" as const, heading: t("themes.darkWindow"), cards: view.available.filter((a) => a.window === "dark") },
  ].filter((g) => g.cards.length > 0);

  const ghost = "shrink-0 rounded-md px-2 py-1 text-[12px] fg-muted hover:bg-hover disabled:opacity-50";

  return (
    <div className="mt-8" data-themes="">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold fg">{t("themes.title")}</h3>
          <p className="mt-0.5 text-[12px] fg-muted">{t("themes.hint")}</p>
        </div>
        <button
          type="button"
          onClick={() => router.push(homeHref(null, "theme"))}
          className="shrink-0 rounded-md border bd px-3 py-1 text-[13px] fg hover:bg-hover"
        >
          {t("themes.newTheme")}
        </button>
      </div>
      {failed ? <p className="mt-2 text-[12px] text-[var(--nc-warn)]">{t("tools.page.failed")}</p> : null}

      {groups.map((group) => (
        <div key={group.window} className="mt-4" data-theme-group={group.window}>
          <h4 className="text-[12px] font-medium fg-muted">{group.heading}</h4>
          <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.cards.map((a) => {
              const onEverywhere = view.applied.everywhere === a.ref;
              const onProject = projectId !== null && view.applied.project === a.ref;
              const twinTitle = a.twinRef ? titleOf(a.twinRef) : undefined;
              const previewingThis = previewing === a.ref;
              const disabled = busy !== null;
              return (
                <li key={a.ref} data-theme-card={a.ref} className="flex min-w-0 flex-col overflow-hidden rounded-lg border bd bg-elev">
                  {a.stillUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.stillUrl} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 pt-2.5 pb-1.5">
                    <p className="truncate text-[13.5px] font-semibold fg">{a.title}</p>
                    {a.blurb ? <p className="text-[12px] fg-muted">{a.blurb}</p> : null}
                    {twinTitle ? <p className="text-[11px] fg-faint">{t("themes.twinOf", { title: twinTitle })}</p> : null}
                    {onEverywhere || onProject ? (
                      <p className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] fg-faint">
                        {onProject ? <span className="rounded border bd px-1.5">{t("themes.onInProject")}</span> : null}
                        {onEverywhere ? <span className="rounded border bd px-1.5">{t("themes.onEverywhere")}</span> : null}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-0.5 gap-y-0.5 px-1.5 pb-1.5">
                    <button type="button" className={ghost} onClick={() => preview(previewingThis ? null : a.ref)}>
                      {previewingThis ? t("themes.stopPreview") : t("themes.preview")}
                    </button>
                    <button type="button" disabled={disabled} className={ghost} onClick={() => void run(a.ref, [() => save("everywhere", a.ref)], true)}>
                      {t("themes.useEverywhere")}
                    </button>
                    {projectId !== null ? (
                      <button type="button" disabled={disabled} className={ghost} onClick={() => void run(a.ref, [() => save("project", a.ref)], true)}>
                        {t("themes.useInProject")}
                      </button>
                    ) : null}
                    {onEverywhere || onProject ? (
                      <button
                        type="button"
                        disabled={disabled}
                        className={ghost}
                        onClick={() =>
                          void run(
                            a.ref,
                            [...(onProject ? [() => save("project", null)] : []), ...(onEverywhere ? [() => save("everywhere", null)] : [])],
                            true,
                          )
                        }
                      >
                        {t("themes.off")}
                      </button>
                    ) : null}
                    {a.source === "installed" && a.projectId ? (
                      <button
                        type="button"
                        disabled={disabled}
                        className={ghost}
                        onClick={() =>
                          void run(
                            a.ref,
                            [() => fetch(`/api/projects/${encodeURIComponent(a.projectId!)}/theme-install`, { method: "DELETE", headers: JSON_HEADERS })],
                            previewingThis,
                          )
                        }
                      >
                        {t("themes.remove")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
