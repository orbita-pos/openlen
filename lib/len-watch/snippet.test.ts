// The snippet that tells OpenLen a published page stayed blank, run for real in jsdom: its
// listeners, its timers and the beacon it sends (or doesn't).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { injectWatchSnippet, WATCH_FALLBACK_MS, WATCH_SETTLE_MS } from "./snippet";

function scriptOf(html: string): string {
  const m = /<script data-ol-watch>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no snippet");
  return m[1]!;
}

let beacon: ReturnType<typeof vi.fn>;

function run(html: string) {
  new Function(scriptOf(html))();
}

beforeEach(() => {
  vi.useFakeTimers();
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><script src="/x.js"></script></head><body></body></html>';

describe("the snippet in the page", () => {
  it("sends one report when the app stays blank, carrying the first startup error", () => {
    document.body.innerHTML = '<div id="root"></div>';
    run(injectWatchSnippet(PAGE, "p1", "menu"));
    window.dispatchEvent(new ErrorEvent("error", { message: "boom at https://a.b/c?token=1", filename: "https://s.openlen.app/assets/i.js?v=2", lineno: 3, colno: 9 }));
    window.dispatchEvent(new ErrorEvent("error", { message: "second" }));
    vi.advanceTimersByTime(WATCH_SETTLE_MS + 10);
    vi.advanceTimersByTime(WATCH_FALLBACK_MS);
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0]!;
    expect(url).toBe("/c/p1");
    expect(JSON.parse(body as string)).toEqual({ t: "f", m: "boom at https://a.b/c", f: "https://s.openlen.app/assets/i.js", l: 3, c: 9, p: "menu" });
  });

  it("stays quiet when the app painted something", () => {
    document.body.innerHTML = '<div id="root"><h1>Hola</h1></div>';
    run(injectWatchSnippet(PAGE, "p1", null));
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    vi.advanceTimersByTime(WATCH_FALLBACK_MS + WATCH_SETTLE_MS);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("does nothing in an automated browser (ours, or a bot)", () => {
    Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
    document.body.innerHTML = '<div id="root"></div>';
    run(injectWatchSnippet(PAGE, "p1", null));
    vi.advanceTimersByTime(WATCH_FALLBACK_MS + WATCH_SETTLE_MS);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("a page with no root is blank only with no text and no media", () => {
    document.body.innerHTML = "<main></main>";
    run(injectWatchSnippet(PAGE, "p1", null));
    vi.advanceTimersByTime(WATCH_FALLBACK_MS + WATCH_SETTLE_MS);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(JSON.parse(beacon.mock.calls[0]![1] as string)).toEqual({ t: "f", m: null, f: null, l: null, c: null, p: null });
  });

  it("cuts a long message to 300 characters", () => {
    document.body.innerHTML = '<div id="root"></div>';
    run(injectWatchSnippet(PAGE, "p1", null));
    window.dispatchEvent(new ErrorEvent("error", { message: "x".repeat(1000) }));
    vi.advanceTimersByTime(WATCH_FALLBACK_MS + WATCH_SETTLE_MS);
    expect((JSON.parse(beacon.mock.calls[0]![1] as string) as { m: string }).m).toHaveLength(300);
  });
});

describe("injectWatchSnippet", () => {
  it("goes first in <head>, before any other script", () => {
    const out = injectWatchSnippet(PAGE, "p1", null);
    expect(out.indexOf("data-ol-watch")).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf("data-ol-watch")).toBeLessThan(out.indexOf('<script src="/x.js">'));
  });

  it("is idempotent", () => {
    const once = injectWatchSnippet(PAGE, "p1", null);
    expect(injectWatchSnippet(once, "p1", null)).toBe(once);
  });

  it("falls back to before </body>, then to the end", () => {
    const noHead = injectWatchSnippet("<html><body><p>x</p></body></html>", "p1", null);
    expect(noHead.indexOf("data-ol-watch")).toBeLessThan(noHead.indexOf("</body>"));
    expect(injectWatchSnippet("x", "p1", null).startsWith("x<script data-ol-watch>")).toBe(true);
  });

  it("finds a <head> with attributes", () => {
    const out = injectWatchSnippet('<html><head lang="es"><title>t</title></head><body></body></html>', "p1", null);
    expect(out.indexOf("data-ol-watch")).toBeLessThan(out.indexOf("<title>"));
  });
});
