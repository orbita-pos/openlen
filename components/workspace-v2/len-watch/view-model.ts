// What the web and Len mobile show of Len Watch (spec local 2026-10-30-len-watch, §5.7): the notice
// over the chat and the three switches in Publish. Pure, so both clients share it.
import type { IncidentStatus, LenWatchSettings } from "@/lib/len-watch/types";

export type BannerState =
  | { kind: "hidden" }
  | { kind: "working" }
  | { kind: "down"; action: "fix" }
  | { kind: "ready"; action: "approve"; shipsUnpublished: boolean };

export function bannerState(incident: { status: IncidentStatus; shipsUnpublished: boolean } | null): BannerState {
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
