// @vitest-environment jsdom
//
// THE NEW-VERSION CHECK AND THE UPDATE OF THE WINDOW OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio,
// §4.4), driven through the hook itself: its guards are called directly, not only through a button that happens to be
// disabled. The window's own test (`desktop-window.test.tsx`) covers what the strip shows.
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOCUS_PROBE_GAP_MS, PROBE_TIMEOUT_MS } from "@/lib/desktop-apps/state-probe";

import { useDesktopUpdate, type DesktopUpdate, type UpdateSource } from "./use-desktop-update";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE: UpdateSource = {
  name: "Bookings",
  frameUrl: "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app/?v=sha1",
  projectId: "p1",
  releaseSha: "sha1",
  locale: "en",
};
const API = "/api/projects/p1/desktop";

let root: Root | null = null;
let host: HTMLDivElement;
/** The hook's latest answer, as the component using it would see it. */
let current: DesktopUpdate;

function Harness({ source }: { source: UpdateSource }) {
  current = useDesktopUpdate(source);
  return null;
}

async function mount(options: { strict?: boolean } = {}) {
  await act(async () => {
    root!.render(options.strict ? <StrictMode><Harness source={SOURCE} /></StrictMode> : <Harness source={SOURCE} />);
  });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const behind = () => json({ desktopApp: { id: "d1", releaseSha: "sha1" }, updateAvailable: true, published: false });
const upToDate = () => json({ desktopApp: { id: "d1", releaseSha: "sha1" }, updateAvailable: false, published: false });
const installed = (releaseSha: string) => json({ desktopApp: { id: "d1", url: "/desktop/d1", name: "Bookings", releaseSha, installedAt: "2026-11-20T12:00:00.000Z" } });

type Call = { method: string; signal: AbortSignal | undefined };
type Handler = (call: Call) => Response | Promise<Response>;
function stubApi(handlers: { get?: Handler; post?: Handler }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) !== API) return json({});
      const call: Call = { method: init?.method ?? "GET", signal: init?.signal ?? undefined };
      calls.push(call);
      return (call.method === "POST" ? handlers.post?.(call) : handlers.get?.(call)) ?? json({}, 500);
    }),
  );
  return calls;
}
const gets = (calls: Call[]) => calls.filter((c) => c.method === "GET").length;
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST").length;
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
function look() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
}
/** A question that never answers, and does not hear it was told to stop either. */
const hung: Handler = () => new Promise<Response>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete (document as unknown as Record<string, unknown>).visibilityState;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the question (spec §4.4, as Claude's own probe asks)", () => {
  it("asks once on opening, even when the effect runs twice (one request in flight, shared)", async () => {
    const calls = stubApi({ get: upToDate });
    await mount({ strict: true });
    await settle();
    expect(gets(calls)).toBe(1);
  });

  it("a question has 8 s: it is told to stop then, and does not block the next one", async () => {
    let n = 0;
    const calls = stubApi({ get: (call) => (++n === 1 ? hung(call) : behind()) });
    await mount();
    await settle();
    expect(gets(calls)).toBe(1);
    await tick(PROBE_TIMEOUT_MS - 1);
    expect(calls[0]!.signal!.aborted).toBe(false);
    await tick(1);
    expect(calls[0]!.signal!.aborted).toBe(true);
    expect(current.available).toBe(false);

    // The window is looked at again once the minute is over: the question goes out, and its answer is shown.
    await tick(FOCUS_PROBE_GAP_MS);
    await act(async () => void look());
    await settle();
    expect(gets(calls)).toBe(2);
    expect(current.available).toBe(true);
  });

  it("looking at the window again asks at most once a minute", async () => {
    const calls = stubApi({ get: upToDate });
    await mount();
    await settle();
    await tick(30_000);
    await act(async () => void look());
    await settle();
    expect(gets(calls)).toBe(1);
    await tick(FOCUS_PROBE_GAP_MS);
    await act(async () => void look());
    await settle();
    expect(gets(calls)).toBe(2);
    // And again right away: that minute starts over.
    await act(async () => void look());
    await settle();
    expect(gets(calls)).toBe(2);
  });

  it("a notice that was up stays up when a later question fails (500, offline or too slow)", async () => {
    let answer: Handler = behind;
    const calls = stubApi({ get: (call) => answer(call) });
    await mount();
    await settle();
    expect(current.available).toBe(true);

    for (const failure of [
      () => json({ error: "boom" }, 500),
      () => Promise.reject(new TypeError("offline")),
      hung,
    ] as Handler[]) {
      answer = failure;
      await tick(FOCUS_PROBE_GAP_MS);
      await act(async () => void look());
      await settle();
      await tick(PROBE_TIMEOUT_MS);
      expect(current.available).toBe(true);
    }
    expect(gets(calls)).toBe(4);
  });
});

describe("the update", () => {
  it("🔴 the guard: «Actualizar» called twice before the first answers sends one POST (the handler, not a disabled button)", async () => {
    let done!: (r: Response) => void;
    const calls = stubApi({ get: behind, post: () => new Promise<Response>((resolve) => void (done = resolve)) });
    await mount();
    await settle();
    await act(async () => {
      void current.update();
      void current.update();
    });
    expect(posts(calls)).toBe(1);
    expect(current.phase).toEqual({ kind: "updating" });

    await act(async () => done(installed("sha2")));
    await settle();
    expect(current.phase).toEqual({ kind: "idle" });
    expect(current.releaseSha).toBe("sha2");
    expect(current.frameUrl).toContain("v=sha2");

    // The place is free again: the next press is a new update.
    await act(async () => {
      void current.update();
    });
    expect(posts(calls)).toBe(2);
    await act(async () => done(installed("sha3")));
    await settle();
  });

  it("🔴 an app that was removed elsewhere is never brought back: the handler itself refuses a second try, and nothing more is asked", async () => {
    const calls = stubApi({ get: behind, post: () => json({ error: "desktop_app_removed" }, 409) });
    await mount();
    await settle();
    await act(async () => void current.update());
    expect(current.phase).toEqual({ kind: "stopped", reason: "removed" });
    expect(JSON.parse(String((vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")![1] as RequestInit).body))).toEqual({
      locale: "en",
      fromWindow: true,
    });

    // Called directly, not through the disabled button: no second POST.
    await act(async () => void current.update());
    expect(posts(calls)).toBe(1);
    // And a window looked at again a minute later asks nothing and clears nothing.
    await tick(FOCUS_PROBE_GAP_MS);
    await act(async () => void look());
    await settle();
    expect(gets(calls)).toBe(1);
    expect(current.phase).toEqual({ kind: "stopped", reason: "removed" });
    expect(current.available).toBe(true);
  });

  it("while it updates, the check of the question says nothing (an answer to an older question is not the news)", async () => {
    let late!: (r: Response) => void;
    let n = 0;
    stubApi({ get: () => (++n === 1 ? behind() : new Promise<Response>((resolve) => void (late = resolve))), post: () => installed("sha2") });
    await mount();
    await settle();
    await tick(FOCUS_PROBE_GAP_MS);
    await act(async () => void look());
    await act(async () => void current.update());
    await settle();
    expect(current.releaseSha).toBe("sha2");
    await act(async () => late(behind()));
    await settle();
    expect(current.available).toBe(false);
  });
});
