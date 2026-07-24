import { describe, expect, it } from "vitest";
import { applySettingsPatch, validateSettingsPatch } from "./settings-patch";
import type { ProjectData } from "./types";

const baseData = (): ProjectData => ({
  html: "<!doctype html><html><head><title>Tacos</title></head><body><h1>Tacos</h1></body></html>",
});

describe("validateSettingsPatch", () => {
  it("rejects a non-object body", () => {
    const v = validateSettingsPatch(null, "p1");
    expect(v.ok).toBe(false);
  });
  it("rejects a non-object body with NO message (route contract: bare invalid_body)", () => {
    for (const raw of [null, "nope", 42]) {
      const v = validateSettingsPatch(raw, "p1");
      expect(v.ok).toBe(false);
      if (v.ok) throw new Error("unreachable");
      expect(v.message).toBeUndefined();
    }
  });
  it("rejects an empty patch (no known keys)", () => {
    const v = validateSettingsPatch({}, "p1");
    expect(v.ok).toBe(false);
  });
  it("accepts a members enable", () => {
    const v = validateSettingsPatch({ members: { enabled: true } }, "p1");
    expect(v.ok).toBe(true);
  });
  it("rejects bad motion value", () => {
    const v = validateSettingsPatch({ motion: "frenetic" }, "p1");
    expect(v.ok).toBe(false);
  });
  it("accepts an orders enable with number", () => {
    const v = validateSettingsPatch({ orders: { enabled: true, number: "5512345678" } }, "p1");
    expect(v.ok).toBe(true);
  });
  it("accepts theme light|dark en bookings/comments y rechaza otros valores", () => {
    expect(validateSettingsPatch({ bookings: { theme: "dark" } }, "p1").ok).toBe(true);
    expect(validateSettingsPatch({ comments: { theme: "light" } }, "p1").ok).toBe(true);
    expect(validateSettingsPatch({ bookings: { theme: "neon" } }, "p1").ok).toBe(false);
    expect(validateSettingsPatch({ comments: { theme: "neon" } }, "p1").ok).toBe(false);
  });

  it("rejects orders with a non-object body", () => {
    const v = validateSettingsPatch({ orders: "yes" }, "p1");
    expect(v.ok).toBe(false);
  });
  it("rejects orders.number over 32 chars", () => {
    const v = validateSettingsPatch({ orders: { number: "x".repeat(33) } }, "p1");
    expect(v.ok).toBe(false);
  });
});

describe("applySettingsPatch", () => {
  it("a bare enable creates NO page — the door at /cuenta is the surface", () => {
    const out = applySettingsPatch(baseData(), { members: { enabled: true } });
    if ("error" in out) throw new Error(out.error);
    expect(out.settings.members?.enabled).toBe(true);
    expect(out.createdPage).toBeNull();
    expect(out.nextData.pages).toBeUndefined();
  });
  it("opting OUT of the door births the gated members page instead", () => {
    const out = applySettingsPatch(baseData(), {
      members: { enabled: true, accountArea: false },
    });
    if ("error" in out) throw new Error(out.error);
    expect(out.createdPage).not.toBeNull();
    expect(out.nextData.pages?.[out.createdPage!.slug]?.membersOnly).toBe(true);
  });
  it("enabling members WITH accountArea does not auto-create the page (Cuentas)", () => {
    const out = applySettingsPatch(baseData(), {
      members: { enabled: true, accountArea: true, passwordLogin: true },
    });
    if ("error" in out) throw new Error(out.error);
    expect(out.settings.members?.enabled).toBe(true);
    expect(out.settings.members?.accountArea).toBe(true);
    expect(out.createdPage).toBeNull();
  });
  it("rejects comments without members", () => {
    const out = applySettingsPatch(baseData(), { comments: { enabled: true } });
    expect("error" in out).toBe(true);
  });
  it("flags chatJustEnabled only on the OFF→ON edge", () => {
    const on = applySettingsPatch(baseData(), { chat: { enabled: true } });
    if ("error" in on) throw new Error(on.error);
    expect(on.chatJustEnabled).toBe(true);
    const already = applySettingsPatch(
      { ...baseData(), settings: { chat: { enabled: true } } },
      { chat: { enabled: true } },
    );
    if ("error" in already) throw new Error(already.error);
    expect(already.chatJustEnabled).toBe(false);
  });
  it("disabling members cascades comments off (reconcile)", () => {
    const out = applySettingsPatch(
      { ...baseData(), settings: { members: { enabled: true }, comments: { enabled: true } } },
      { members: { enabled: false } },
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.settings.comments?.enabled).toBe(false);
  });
  it("merges orders preserving prior fields", () => {
    const data: ProjectData = {
      ...baseData(),
      settings: { orders: { number: "5512345678" } },
    };
    const out = applySettingsPatch(data, { orders: { enabled: true } });
    if ("error" in out) throw new Error(out.error);
    expect(out.settings.orders?.enabled).toBe(true);
    expect(out.settings.orders?.number).toBe("5512345678");
  });
});
