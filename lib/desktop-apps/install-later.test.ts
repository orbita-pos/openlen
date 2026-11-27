// @vitest-environment jsdom
//
// «AHORA NO» ON THE WINDOW'S INSTALL CARD (spec local 2026-11-26-apps-en-el-escritorio, §4.3): remembered per app in this
// browser, so the card does not ask again on every open. Storage is a convenience: the card works without it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissInstallCard, installCardDismissed } from "./install-later";

beforeEach(() => void localStorage.clear());
afterEach(() => void vi.restoreAllMocks());

describe("the install card's «Not now»", () => {
  it("is remembered for that app and no other", () => {
    expect(installCardDismissed("d1")).toBe(false);
    dismissInstallCard("d1");
    expect(installCardDismissed("d1")).toBe(true);
    expect(installCardDismissed("d2")).toBe(false);
  });

  it("is under a key of OpenLen's own, per app", () => {
    dismissInstallCard("d1");
    expect(Object.keys(localStorage)).toEqual(["openlen:desktop-install-later:d1"]);
  });

  it("🔴 works without storage: a blocked or full one is «not dismissed» and a write that throws is not an error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(installCardDismissed("d1")).toBe(false);
    expect(() => dismissInstallCard("d1")).not.toThrow();
  });

  it("an id with odd characters can't reach another app's key", () => {
    dismissInstallCard("d1:x");
    expect(installCardDismissed("d1")).toBe(false);
  });
});
