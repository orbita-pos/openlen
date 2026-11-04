// WHAT THE WORKSPACE SEES OF AN INSTALLED TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.11, §4.13): its
// display record in the person's language (English as the fallback), its icon, where it goes, and whether it
// can open at all — removed, on the Free plan, or with its release gone, it has no frame.
import "server-only";

import type { Plan } from "@/lib/plan";

import { toolFrameUrl } from "./host";
import type { ToolInstallationRow } from "./store";
import type { InstalledToolStatus, InstalledToolView } from "./types";

export type { InstalledToolStatus, InstalledToolView };

function inLocale(texts: Readonly<Record<string, string>>, locale: string): string {
  return texts[locale] ?? texts.en ?? Object.values(texts)[0] ?? "";
}

export function toInstalledToolView(
  row: ToolInstallationRow,
  o: {
    readonly locale: string;
    readonly requestHost: string | null;
    readonly plan: Plan;
    readonly releaseExists: boolean;
    readonly env?: Readonly<Record<string, string | undefined>>;
  },
): InstalledToolView {
  const status: InstalledToolStatus = row.removedAt
    ? "removed"
    : o.plan === "free"
      ? "plan_required"
      : !o.releaseExists
        ? "broken"
        : "ok";
  const frameUrl = status === "ok" ? toolFrameUrl({ hostLabel: row.hostLabel, releaseSha: row.releaseSha, requestHost: o.requestHost }, o.env) : null;
  return {
    id: row.id,
    projectId: row.projectId,
    title: inLocale(row.titles, o.locale),
    description: inLocale(row.descriptions, o.locale),
    placement: row.placement,
    iconUrl: `/api/tools/${encodeURIComponent(row.id)}/icon?v=${encodeURIComponent(row.releaseSha)}`,
    iconTinted: /.svg$/i.test(row.iconPath),
    frameUrl,
    frameOrigin: frameUrl ? new URL(frameUrl).origin : null,
    releaseSha: row.releaseSha,
    enabled: row.enabled,
    installedAt: row.installedAt.toISOString(),
    status,
  };
}
