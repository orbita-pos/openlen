"use client";

// «INSTALAR» IN A THEME PROJECT'S TOP BAR (spec local 2026-11-27-temas-del-workspace, §4.2): a theme is never published
// as a site — the site route answers 409 `project_is_theme` — so in a theme project, as in a tool project, installing
// takes «Publicar»'s place. Only the owner sees it (the route refuses anyone else). One tap installs for the person
// (`POST /api/projects/<id>/theme-install`): nothing runs and nothing is public, so there is no card to confirm. What the
// install says comes back in a toast — installed (with what the contrast gate could not fix or measure), or the
// manifest's and scenes' problems file by file — and the workspace reads its themes again, so a theme already picked
// from this project repaints with the new version.
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { useToast } from "../toast";
import { reloadWorkspaceThemes } from "./use-workspace-theme";

interface Problem {
  code?: unknown;
  file?: unknown;
  detail?: unknown;
}
interface Warning {
  themeId?: unknown;
  code?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function ThemeInstallButton({ projectId }: { projectId: string }) {
  const t = useTranslations("wsChrome");
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const problemLine = (p: Problem) =>
    t("themes.install.problem", { file: str(p.file) || "/package.json", code: str(p.code), detail: str(p.detail) ? ` (${str(p.detail)})` : "" });

  const warningLine = (w: Warning) => {
    const theme = str(w.themeId);
    switch (w.code) {
      case "glass_unmeasured":
        return t("themes.install.warnings.glass_unmeasured", { theme });
      case "glass_below_target":
        return t("themes.install.warnings.glass_below_target", { theme });
      case "palette_pair":
        return t("themes.install.warnings.palette_pair", { theme });
      default:
        return null;
    }
  };

  async function install() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/theme-install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; problems?: Problem[]; contrastWarnings?: Warning[] };
      if (res.ok) {
        // Each theme's warning once, however many the gate reported for it.
        const lines = [...new Set((body.contrastWarnings ?? []).map(warningLine).filter((l): l is string => l !== null))];
        toast.success(t("themes.install.done"), lines.length > 0 ? { description: lines.join(" · "), duration: 0 } : undefined);
        reloadWorkspaceThemes();
      } else if (res.status === 422 && Array.isArray(body.problems) && body.problems.length > 0) {
        toast.error(t("themes.install.problems", { count: body.problems.length }), { description: body.problems.map(problemLine).join(" · "), duration: 0 });
      } else if (res.status === 429) {
        toast.info(t("themes.install.inProgress"));
      } else {
        toast.error(t("themes.install.failed"));
      }
    } catch {
      toast.error(t("themes.install.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-theme-install
      onClick={() => void install()}
      disabled={busy}
      aria-busy={busy}
      aria-label={t("themes.install.button")}
      className="ml-0.5 inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-md bg-[var(--accent-strong)] text-white text-[12px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition disabled:opacity-60 disabled:cursor-wait"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : null}
      <span className="hidden sm:inline">{busy ? t("themes.install.installing") : t("themes.install.button")}</span>
    </button>
  );
}
