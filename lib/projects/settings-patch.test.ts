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
});

describe("applySettingsPatch", () => {
  it("enables members and births the auto members page (legacy, no accountArea)", () => {
    const out = applySettingsPatch(baseData(), { members: { enabled: true } });
    if ("error" in out) throw new Error(out.error);
    expect(out.settings.members?.enabled).toBe(true);
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
});

describe("overlay settings", () => {
  it("first enable mints a server-side token", () => {
    const out = applySettingsPatch(baseData(), { overlay: { enabled: true } });
    if ("error" in out) throw new Error(out.error);
    expect(out.settings.overlay?.enabled).toBe(true);
    expect(out.settings.overlay?.token).toMatch(/^[a-f0-9]{32}$/);
  });
  it("re-enable keeps the existing token; regenerateToken mints a new one", () => {
    const first = applySettingsPatch(baseData(), { overlay: { enabled: true } });
    if ("error" in first) throw new Error(first.error);
    const tok = first.settings.overlay!.token!;
    const again = applySettingsPatch(first.nextData, { overlay: { enabled: true } });
    if ("error" in again) throw new Error(again.error);
    expect(again.settings.overlay?.token).toBe(tok);
    const regen = applySettingsPatch(first.nextData, { overlay: { regenerateToken: true } });
    if ("error" in regen) throw new Error(regen.error);
    expect(regen.settings.overlay?.token).not.toBe(tok);
  });
  it("client-supplied token is ignored", () => {
    const v = validateSettingsPatch({ overlay: { enabled: true, token: "hax" } }, "p1");
    expect(v.ok).toBe(false); // token no es key aceptada del patch
  });
  it("validates goal ranges and label length", () => {
    expect(validateSettingsPatch({ overlay: { goal: { label: "Subs", current: -1, target: 500 } } }, "p1").ok).toBe(false);
    expect(validateSettingsPatch({ overlay: { goal: { label: "", current: 0, target: 500 } } }, "p1").ok).toBe(false);
    expect(validateSettingsPatch({ overlay: { goal: { label: "Subs", current: 10, target: 0 } } }, "p1").ok).toBe(false);
    const ok = validateSettingsPatch({ overlay: { goal: { label: "Meta de subs", current: 340, target: 500 } } }, "p1");
    expect(ok.ok).toBe(true);
  });
  it("goal: null clears an existing goal, keeping enabled/token intact", () => {
    const on = applySettingsPatch(baseData(), {
      overlay: { enabled: true, goal: { label: "Subs", current: 10, target: 500 } },
    });
    if ("error" in on) throw new Error(on.error);
    const tok = on.settings.overlay!.token!;
    expect(validateSettingsPatch({ overlay: { goal: null } }, "p1").ok).toBe(true);
    const cleared = applySettingsPatch(on.nextData, { overlay: { goal: null } });
    if ("error" in cleared) throw new Error(cleared.error);
    expect(cleared.settings.overlay?.goal).toBeUndefined();
    expect(cleared.settings.overlay?.enabled).toBe(true);
    expect(cleared.settings.overlay?.token).toBe(tok);
  });
  it("screen enum + null clears", () => {
    expect(validateSettingsPatch({ overlay: { screen: "fiesta" } }, "p1").ok).toBe(false);
    const on = applySettingsPatch(baseData(), { overlay: { enabled: true, screen: "brb" } });
    if ("error" in on) throw new Error(on.error);
    expect(on.settings.overlay?.screen).toBe("brb");
    const off = applySettingsPatch(on.nextData, { overlay: { screen: null } });
    if ("error" in off) throw new Error(off.error);
    expect(off.settings.overlay?.screen).toBeUndefined();
  });
});
