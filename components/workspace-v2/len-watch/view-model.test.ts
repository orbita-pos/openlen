import { describe, expect, it } from "vitest";

import { bannerState, patchFor, settingsRows } from "./view-model";

const S = { autoFix: false, autoPublish: false, muted: false, locale: null };

describe("bannerState", () => {
  it("no incident, or a resolved one: nothing shows", () => {
    expect(bannerState(null)).toEqual({ kind: "hidden" });
    expect(bannerState({ status: "resolved", shipsUnpublished: false })).toEqual({ kind: "hidden" });
  });

  it("Len at work: no button", () => {
    expect(bannerState({ status: "fixing", shipsUnpublished: false })).toEqual({ kind: "working" });
    expect(bannerState({ status: "publishing", shipsUnpublished: false })).toEqual({ kind: "working" });
  });

  it("down with nobody on it: «Fix with Len»", () => {
    for (const status of ["open", "needs_owner", "fix_failed"] as const) {
      expect(bannerState({ status, shipsUnpublished: false })).toEqual({ kind: "down", action: "fix" });
    }
  });

  it("a fix waiting: Approve, saying when unpublished changes would go too", () => {
    expect(bannerState({ status: "fix_ready", shipsUnpublished: true })).toEqual({ kind: "ready", action: "approve", shipsUnpublished: true });
  });

  // Spec §5.5: a fix published from its branch that the draft doesn't have yet.
  it("a fix to bring into the draft: «Traer el arreglo», unless something about the site is still going on", () => {
    const pending = { incidentId: "i1", branch: "len-watch/i1" };
    expect(bannerState(null, pending)).toEqual({ kind: "bring", incidentId: "i1" });
    expect(bannerState({ status: "resolved", shipsUnpublished: false }, pending)).toEqual({ kind: "bring", incidentId: "i1" });
    expect(bannerState({ status: "fixing", shipsUnpublished: false }, pending)).toEqual({ kind: "working" });
    expect(bannerState(null, null)).toEqual({ kind: "hidden" });
  });

  it("🔴 the fix changes tables, so it waits in its branch: the notice brings it, never «Fix with Len» again", () => {
    expect(bannerState({ id: "i1", status: "needs_owner", shipsUnpublished: false }, { incidentId: "i1" })).toEqual({ kind: "bring", incidentId: "i1" });
  });

  it("a NEW crash while an older fix waits to be brought: the crash comes first", () => {
    expect(bannerState({ id: "i2", status: "needs_owner", shipsUnpublished: false }, { incidentId: "i1" })).toEqual({ kind: "down", action: "fix" });
  });
});

describe("settingsRows", () => {
  it("publishing on its own waits for fixing on its own", () => {
    const rows = settingsRows(S, true);
    expect(rows.map((r) => r.key)).toEqual(["watch", "autoFix", "autoPublish"]);
    expect(rows.find((r) => r.key === "watch")).toEqual({ key: "watch", checked: true, disabled: false });
    expect(rows.find((r) => r.key === "autoPublish")?.disabled).toBe(true);
    expect(settingsRows({ ...S, autoFix: true }, true).find((r) => r.key === "autoPublish")?.disabled).toBe(false);
  });

  it("only the owner can change them", () => {
    expect(settingsRows({ ...S, autoFix: true }, false).every((r) => r.disabled)).toBe(true);
  });

  it("watching is the opposite of muted", () => {
    expect(settingsRows({ ...S, muted: true }, true)[0]).toMatchObject({ key: "watch", checked: false });
  });
});

describe("patchFor", () => {
  it("turns a switch into what the API saves", () => {
    expect(patchFor("watch", false)).toEqual({ muted: true });
    expect(patchFor("autoFix", true)).toEqual({ autoFix: true });
    expect(patchFor("autoPublish", false)).toEqual({ autoPublish: false });
  });
});
