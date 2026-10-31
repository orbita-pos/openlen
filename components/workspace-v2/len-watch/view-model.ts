// What the web and Len mobile show of Len Watch (spec local 2026-10-30-len-watch, §5.7): the notice
// over the chat and the three switches in Publish. Pure, so both clients share it.
import type { IncidentStatus, LenWatchSettings } from "@/lib/len-watch/types";

export type BannerState =
  | { kind: "hidden" }
  | { kind: "working" }
  | { kind: "down"; action: "fix" }
  | { kind: "ready"; action: "approve"; shipsUnpublished: boolean }
  /** Spec §5.5: a fix published from its branch that the draft doesn't have yet — «Traer el arreglo». */
  | { kind: "bring"; incidentId: string }
  /** The crash's own fix (it changes tables) is in the draft and the site is still down: the owner publishes. */
  | { kind: "publish" };

export function bannerState(
  incident: { id?: string; status: IncidentStatus; shipsUnpublished: boolean; fixBrought?: boolean } | null,
  pendingFix: { incidentId: string } | null = null,
): BannerState {
  // What is going on with the site comes first; a fix to bring shows once nothing else does — or when it is this
  // crash's own fix, waiting in its branch because it changes tables (spec §5.5): fixing it again would cut it over.
  const site = siteState(incident);
  // Brought already: what's missing is the owner's publish, which carries the fix and its migration.
  if (site.kind === "down" && incident?.fixBrought) return { kind: "publish" };
  if (!pendingFix) return site;
  return site.kind === "hidden" || (incident?.id === pendingFix.incidentId && site.kind === "down") ? { kind: "bring", incidentId: pendingFix.incidentId } : site;
}

function siteState(incident: { status: IncidentStatus; shipsUnpublished: boolean } | null): BannerState {
  if (!incident) return { kind: "hidden" };
  switch (incident.status) {
    case "fixing":
    case "publishing":
      return { kind: "working" };
    case "open":
    case "needs_owner":
    case "fix_failed":
      return { kind: "down", action: "fix" };
    case "fix_ready":
      return { kind: "ready", action: "approve", shipsUnpublished: incident.shipsUnpublished };
    case "resolved":
      return { kind: "hidden" };
  }
}

export type SettingKey = "watch" | "autoFix" | "autoPublish";

export interface SettingRow {
  key: SettingKey;
  checked: boolean;
  disabled: boolean;
}

/** «Watch and notify» is on unless muted; «Publish on its own» waits for «Fix on its own»; only the
 *  owner changes any of them (it's their credits). */
export function settingsRows(s: LenWatchSettings, isOwner: boolean): SettingRow[] {
  return [
    { key: "watch", checked: !s.muted, disabled: !isOwner },
    { key: "autoFix", checked: s.autoFix, disabled: !isOwner },
    { key: "autoPublish", checked: s.autoPublish, disabled: !isOwner || !s.autoFix },
  ];
}

export function patchFor(key: SettingKey, checked: boolean): Partial<LenWatchSettings> {
  if (key === "watch") return { muted: !checked };
  return key === "autoFix" ? { autoFix: checked } : { autoPublish: checked };
}
