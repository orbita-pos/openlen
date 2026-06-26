import { describe, expect, it, vi } from "vitest";
import { createHub, hub } from "@/lib/chat/hub";

describe("chat hub", () => {
  it("delivers a published message only to that conversation's subscribers", () => {
    const a = vi.fn(), b = vi.fn();
    const offA = hub.subscribe("c1", { id: "s1", userId: "u1", send: a });
    hub.subscribe("c2", { id: "s2", userId: "u2", send: b });
    hub.publish("c1", { type: "message", message: { id: "m1" } as never });
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    offA();
    hub.publish("c1", { type: "message", message: { id: "m2" } as never });
    expect(a).toHaveBeenCalledOnce(); // unsubscribed
  });
  it("tracks presence per project (online until offline)", () => {
    hub.markOnline("p1", "owner1");
    expect(hub.isProjectStaffOnline("p1", "owner1", [])).toBe(true);
    expect(hub.isProjectStaffOnline("p2", "owner1", [])).toBe(false);
  });
  it("counts an agent as staff-online", () => {
    hub.markOnline("p3", "agentX");
    expect(hub.isProjectStaffOnline("p3", "ownerZ", ["agentX"])).toBe(true);
  });

  // --- new cases ---

  it("refcount: markOnline twice + markOffline once → still online", () => {
    const h = createHub();
    h.markOnline("p", "u");
    h.markOnline("p", "u");
    h.markOffline("p", "u");
    expect(h.isUserOnline("p", "u")).toBe(true);
  });

  it("grace window: isUserOnline true immediately after markOffline, false after grace expires", () => {
    vi.useFakeTimers();
    const h = createHub();
    h.markOnline("p", "u");
    h.markOffline("p", "u");
    expect(h.isUserOnline("p", "u")).toBe(true); // still in grace window
    vi.advanceTimersByTime(13_000);
    expect(h.isUserOnline("p", "u")).toBe(false); // grace expired
    vi.useRealTimers();
  });

  it("throwing send doesn't abort fan-out to remaining subscribers", () => {
    const h = createHub();
    const bad = vi.fn().mockImplementation(() => { throw new Error("closed"); });
    const good = vi.fn();
    h.subscribe("c", { id: "s1", userId: "u1", send: bad });
    h.subscribe("c", { id: "s2", userId: "u2", send: good });
    h.publish("c", { type: "presence", userId: "u1", online: false });
    expect(good).toHaveBeenCalledOnce();
  });

  it("isUserOnline: false for unknown user/project", () => {
    const h = createHub();
    expect(h.isUserOnline("unknown-project", "unknown-user")).toBe(false);
  });
});
