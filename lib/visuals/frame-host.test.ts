// WHAT THE CHAT TAKES FROM A VISUAL'S FRAME (spec local 2026-11-22-visuales-de-verdad, §2): the one core the web's frame and
// the phone's both use. Only its own frame, only its own origin; a prompt only right after a tap, once per tap; and what it
// shares about itself (updateModelContext) at any time — it is the visual's state, read only when the agent asks.
import { describe, expect, it, vi } from "vitest";

import { createVisualFrameHost } from "./frame-host";

const ORIGIN = "https://lienzo-visuals.example";

function setup(o: { isolated?: boolean; frameOrigin?: string | null; isFocused?: () => boolean } = {}) {
  let now = 1_000_000;
  const frame = {} as Window;
  const calls = { ready: 0, heights: [] as number[], links: [] as string[], prompts: [] as string[], states: [] as string[] };
  const host = createVisualFrameHost({
    frameOrigin: o.frameOrigin === undefined ? ORIGIN : o.frameOrigin,
    isolated: o.isolated ?? false,
    now: () => now,
    ...(o.isFocused ? { isFocused: o.isFocused } : {}),
    onReady: () => void calls.ready++,
    onHeight: (h) => void calls.heights.push(h),
    onLink: (href) => void calls.links.push(href),
    onPrompt: (text) => void calls.prompts.push(text),
    onState: (text) => void calls.states.push(text),
  });
  const send = (data: unknown, from: { source?: unknown; origin?: string } = {}) =>
    host.onMessage({ data, source: from.source ?? frame, origin: from.origin ?? (o.frameOrigin === null ? "null" : ORIGIN) } as MessageEvent, frame);
  return { host, send, calls, frame, advance: (ms: number) => void (now += ms) };
}

describe("createVisualFrameHost", () => {
  it("what the visual shares about itself is taken with no tap, and cleaned", () => {
    const t = setup();
    t.send({ kind: "ol-visual:context", text: "  3 of 5  " });
    expect(t.calls.states).toEqual(["3 of 5"]);
  });

  it("a prompt counts only right after a tap, and once per tap", () => {
    const t = setup();
    t.send({ kind: "ol-visual:prompt", text: "Check ↗" });
    expect(t.calls.prompts).toEqual([]);
    t.host.markClick();
    t.send({ kind: "ol-visual:prompt", text: "Check ↗" });
    t.send({ kind: "ol-visual:prompt", text: "again" });
    expect(t.calls.prompts).toEqual(["Check ↗"]);
    t.host.markClick();
    t.advance(6000);
    t.send({ kind: "ol-visual:prompt", text: "late" });
    expect(t.calls.prompts).toEqual(["Check ↗"]);
  });

  it("🔴 a message from another window or another origin is ignored", () => {
    const t = setup();
    t.send({ kind: "ol-visual:context", text: "x" }, { source: {} });
    t.send({ kind: "ol-visual:context", text: "x" }, { origin: "https://evil.example" });
    expect(t.calls.states).toEqual([]);
  });

  it("🔴 an isolated frame (a visitor could steer it) never reports a state nor opens a link", () => {
    const t = setup({ isolated: true, frameOrigin: null });
    t.send({ kind: "ol-visual:context", text: "x" }, { origin: "null" });
    t.send({ kind: "ol-visual:link", href: "https://x.example" }, { origin: "null" });
    expect(t.calls.states).toEqual([]);
    expect(t.calls.links).toEqual([]);
  });

  it("ready, a capped height and an http(s) link come through", () => {
    const t = setup();
    t.send({ kind: "ol-visual:ready" });
    t.send({ kind: "ol-visual:height", height: 99_999 });
    t.send({ kind: "ol-visual:link", href: "javascript:alert(1)" });
    t.send({ kind: "ol-visual:link", href: "https://x.example/a" });
    expect(t.calls.ready).toBe(1);
    expect(t.calls.heights).toEqual([2000]);
    expect(t.calls.links).toEqual(["https://x.example/a"]);
  });

  it("something that isn't the frame's protocol is nothing", () => {
    const t = setup();
    const before = JSON.stringify(t.calls);
    t.send({ kind: "nope" });
    t.send("text");
    expect(JSON.stringify(t.calls)).toBe(before);
    vi.restoreAllMocks();
  });

  // Minor #1: multi-card visuals (e.g. 5–8 language exercises) keep focus inside the iframe past 5 s before Done ↗.
  it("🔴 a prompt after 5 s still counts once while the frame stays focused after a tap, never without a tap or after leaving focus", () => {
    let focused = true;
    const t = setup({ isFocused: () => focused });
    // Even if focused, never before a tap.
    t.send({ kind: "ol-visual:prompt", text: "no tap" });
    expect(t.calls.prompts).toEqual([]);

    // Tap, work inside the visual for 45 s, then tap Done ↗: allowed once.
    t.host.markClick();
    t.advance(45_000);
    t.send({ kind: "ol-visual:prompt", text: "Done ↗" });
    t.send({ kind: "ol-visual:prompt", text: "second" });
    expect(t.calls.prompts).toEqual(["Done ↗"]);

    // Once focus leaves the frame (or tab hides), past 5 s is still rejected.
    t.host.markClick();
    focused = false;
    t.advance(6_000);
    t.send({ kind: "ol-visual:prompt", text: "after leaving" });
    expect(t.calls.prompts).toEqual(["Done ↗"]);

    // Even staying focused, an abandoned session past the focused window expires.
    focused = true;
    t.host.markClick();
    t.advance(11 * 60_000);
    t.send({ kind: "ol-visual:prompt", text: "too late" });
    expect(t.calls.prompts).toEqual(["Done ↗"]);
  });
});
