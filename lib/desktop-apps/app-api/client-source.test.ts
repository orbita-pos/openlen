// window.openlenApp, the script OpenLen injects into an app on the desktop (spec local 2026-11-27-notificaciones-del-escritorio,
// §4.2), run against a FAKE window: a fake parent that records what it is sent, and events delivered with the origin and
// the source the test chooses (jsdom's own postMessage sets neither). It talks to its parent by postMessage with an
// explicit target origin, takes an answer only from `window.parent`, from one of the origins it was built with, on its
// channel, for a request it made (Review Focus 1); and `manage()` needs a gesture of the last 5 s.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appApiClientSource } from "./client-source";
import { APP_API_CHANNEL, isAppApiResponse } from "./protocol";

const APP = "https://openlen.com";
const DEV = ["https://openlen.com", "http://localhost:3000", "http://127.0.0.1:3000"];

type Api = {
  permissions: { state(n?: unknown): Promise<unknown>; request(n?: unknown): Promise<unknown>; manage(): Promise<unknown> };
  notification: { show(o?: unknown): Promise<unknown> };
};
type Handler = (e: Record<string, unknown>) => void;

interface FakeWindow {
  parent: unknown;
  openlenApp?: Api;
  crypto?: unknown;
  navigator: { userActivation?: { isActive: boolean } };
  document: { referrer: string };
  location: { ancestorOrigins?: string[] };
  addEventListener(type: string, fn: Handler, capture?: boolean): void;
}

function build(
  o: {
    origins?: string[];
    framed?: boolean;
    userActivation?: { isActive: boolean } | null;
    referrer?: string;
    ancestorOrigins?: string[];
    crypto?: unknown;
    postMessage?: (m: unknown, t: string) => void;
  } = {},
) {
  const handlers = new Map<string, Handler[]>();
  const postMessage = vi.fn(o.postMessage ?? (() => undefined));
  const parent = { postMessage };
  const win = {
    parent,
    crypto: "crypto" in o ? o.crypto : globalThis.crypto,
    navigator: o.userActivation === null ? {} : { userActivation: o.userActivation ?? { isActive: true } },
    document: { referrer: o.referrer ?? "" },
    location: o.ancestorOrigins ? { ancestorOrigins: o.ancestorOrigins } : {},
    addEventListener: (type: string, fn: Handler) => {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
  } as unknown as FakeWindow;
  if (o.framed === false) win.parent = win;
  new Function("window", appApiClientSource(o.origins ?? [APP]))(win);
  const api = win.openlenApp as Api;
  const emit = (type: string, event: Record<string, unknown>) => (handlers.get(type) ?? []).forEach((h) => h(event));
  const deliver = (data: unknown, from: { source?: unknown; origin?: string } = {}) =>
    emit("message", { source: "source" in from ? from.source : parent, origin: from.origin ?? (o.origins ?? [APP])[0], data });
  const gesture = (type = "click", isTrusted = true) => emit(type, { type, isTrusted });
  const requests = () => postMessage.mock.calls.map((c) => c[0] as { channel: string; id: string; method: string; args: unknown });
  const last = () => requests().at(-1)!;
  return { win, api, parent, postMessage, deliver, gesture, requests, last };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("window.openlenApp", () => {
  it("exposes openlenApp with the four methods, frozen, each answering with a promise", () => {
    const f = build();
    expect(Object.keys(f.api).sort()).toEqual(["notification", "permissions"]);
    expect(Object.keys(f.api.permissions).sort()).toEqual(["manage", "request", "state"]);
    expect(Object.keys(f.api.notification)).toEqual(["show"]);
    expect(Object.isFrozen(f.api)).toBe(true);
    expect(Object.isFrozen(f.api.permissions)).toBe(true);
    expect(Object.isFrozen(f.api.notification)).toBe(true);
    f.gesture();
    for (const p of [f.api.permissions.state(), f.api.permissions.request(), f.api.permissions.manage(), f.api.notification.show({ body: "x" })]) {
      expect(p).toBeInstanceOf(Promise);
      void p.catch(() => undefined);
    }
  });

  it("posts to the parent with the channel, a method and its args, and resolves on the matching answer", async () => {
    const f = build();
    const p = f.api.permissions.state("notifications");
    const r = f.last();
    expect(r).toEqual({ channel: APP_API_CHANNEL, id: r.id, method: "permissions.state", args: { name: "notifications" } });
    expect(f.postMessage).toHaveBeenCalledWith(r, APP);
    f.deliver({ channel: APP_API_CHANNEL, id: r.id, ok: true, value: "prompt" });
    await expect(p).resolves.toBe("prompt");
  });

  it("what is still waiting is posted again, same id, when the window says ready — only from the parent, and once answered no more", async () => {
    const f = build();
    const p = f.api.permissions.state("notifications");
    const first = f.last();
    f.deliver({ channel: APP_API_CHANNEL, ready: true }, { origin: "https://evil.openlen.app" });
    f.deliver({ channel: APP_API_CHANNEL, ready: true }, { source: {} });
    expect(f.requests()).toHaveLength(1);
    f.deliver({ channel: APP_API_CHANNEL, ready: true });
    expect(f.requests()).toEqual([first, first]);
    expect(f.postMessage).toHaveBeenLastCalledWith(first, APP);
    f.deliver({ channel: APP_API_CHANNEL, id: first.id, ok: true, value: "prompt" });
    await expect(p).resolves.toBe("prompt");
    f.deliver({ channel: APP_API_CHANNEL, ready: true });
    expect(f.requests()).toHaveLength(2);
  });

  it("an error answer rejects with an Error whose code is the answer's code", async () => {
    const f = build();
    const p = f.api.notification.show({ body: "hi" });
    f.deliver({ channel: APP_API_CHANNEL, id: f.last().id, ok: false, code: "EPERM", message: "notifications are not allowed" });
    const e = (await p.catch((x: unknown) => x)) as Error & { code?: string };
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("EPERM");
    expect(e.message).toBe("notifications are not allowed");
  });

  it("an answer settles its request once, and a second one for the same id is nothing", async () => {
    const f = build();
    const p = f.api.permissions.state();
    const id = f.last().id;
    f.deliver({ channel: APP_API_CHANNEL, id, ok: true, value: { notifications: "prompt" } });
    f.deliver({ channel: APP_API_CHANNEL, id, ok: true, value: { notifications: "granted" } });
    await expect(p).resolves.toEqual({ notifications: "prompt" });
  });

  it("each call has its own answer, whatever the order they come in", async () => {
    const f = build();
    const a = f.api.permissions.state("notifications");
    const b = f.api.permissions.state("overlay");
    const [ra, rb] = f.requests();
    f.deliver({ channel: APP_API_CHANNEL, id: rb!.id, ok: true, value: "unavailable" });
    f.deliver({ channel: APP_API_CHANNEL, id: ra!.id, ok: true, value: "granted" });
    await expect(a).resolves.toBe("granted");
    await expect(b).resolves.toBe("unavailable");
  });

  it("ids are random and unguessable: a UUID each, never repeated, and no Math.random in the script", () => {
    const f = build();
    for (let i = 0; i < 20; i++) void f.api.permissions.state().catch(() => undefined);
    const ids = f.requests().map((r) => r.id);
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{32,36}$/);
    expect(appApiClientSource([APP])).not.toContain("Math.random");
  });

  it("with no randomUUID it uses getRandomValues, and with no crypto at all it refuses to ask", async () => {
    const onlyValues = build({ crypto: { getRandomValues: (a: Uint8Array) => globalThis.crypto.getRandomValues(a) } });
    void onlyValues.api.permissions.state().catch(() => undefined);
    void onlyValues.api.permissions.state().catch(() => undefined);
    const [a, b] = onlyValues.requests();
    expect(a!.id).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.id).not.toBe(a!.id);

    const none = build({ crypto: undefined });
    const e = (await none.api.permissions.state().catch((x: unknown) => x)) as Error & { code?: string };
    expect(e.code).toBe("ENOTSUP");
    expect(none.postMessage).not.toHaveBeenCalled();
  });
});

describe("what the script takes as an answer", () => {
  const timesOut = async (p: Promise<unknown>) => {
    const done = expect(p.catch((x: unknown) => x)).resolves.toMatchObject({ code: "ENOTSUP" });
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
  };

  it("ignores an answer from another origin or another window", async () => {
    const f = build();
    const p = f.api.permissions.state("notifications");
    const answer = { channel: APP_API_CHANNEL, id: f.last().id, ok: true, value: "granted" };
    f.deliver(answer, { origin: "https://evil.example" });
    f.deliver(answer, { origin: "null" });
    f.deliver(answer, { origin: "https://openlen.com.evil.example" });
    f.deliver(answer, { source: {} });
    f.deliver(answer, { source: f.win });
    f.deliver(answer, { source: null });
    f.deliver(answer, { source: undefined });
    await timesOut(p);
  });

  it("ignores an answer on another channel, for an id it never asked, or malformed", async () => {
    const f = build();
    const p = f.api.permissions.state("notifications");
    const id = f.last().id;
    f.deliver({ channel: "openlen-tool", id, ok: true, value: "granted" });
    f.deliver({ jsonrpc: "2.0", id: 1, result: "granted", channel: "openlen-tool" });
    f.deliver({ channel: APP_API_CHANNEL, id: "something-else", ok: true, value: "granted" });
    f.deliver({ channel: APP_API_CHANNEL, id, ok: false, code: "EACCES", message: "x" });
    f.deliver({ channel: APP_API_CHANNEL, id, ok: false, code: "EPERM" });
    f.deliver({ channel: APP_API_CHANNEL, id });
    for (const junk of [null, undefined, "granted", 7, [], { id }]) f.deliver(junk);
    await timesOut(p);
  });

  it("takes exactly what the protocol's own check takes (the two are one rule)", async () => {
    const table: Array<(id: string) => unknown> = [
      (id) => ({ channel: APP_API_CHANNEL, id, ok: true, value: 1 }),
      (id) => ({ channel: APP_API_CHANNEL, id, ok: true }),
      (id) => ({ channel: APP_API_CHANNEL, id, ok: false, code: "EINVAL", message: "m" }),
      (id) => ({ channel: APP_API_CHANNEL, id, ok: false, code: "ENOTSUP", message: "m" }),
      (id) => ({ channel: "x", id, ok: true }),
      (id) => ({ channel: APP_API_CHANNEL, id, ok: "true" }),
      (id) => ({ channel: APP_API_CHANNEL, id, ok: false, code: "EPERM" }),
      (id) => ({ channel: APP_API_CHANNEL, id, ok: false, code: "EBUSY", message: "m" }),
      (id) => ({ channel: APP_API_CHANNEL, id, ok: false, code: "EPERM", message: 1 }),
      (id) => ({ channel: APP_API_CHANNEL, id }),
      (id) => ({ id, ok: true }),
      (id) => [id],
      () => null,
    ];
    for (const make of table) {
      const f = build();
      let settled = false;
      const p = f.api.permissions.state();
      void p.then(() => (settled = true), () => (settled = true));
      f.deliver(make(f.last().id));
      await Promise.resolve();
      await Promise.resolve();
      expect(settled, JSON.stringify(make("ID"))).toBe(isAppApiResponse(make(f.last().id)));
    }
  });

  it("a call the window never answers ends in ENOTSUP after 30 s, and does not leave its answer listening", async () => {
    const f = build();
    const p = f.api.notification.show({ body: "x" });
    const id = f.last().id;
    await timesOut(p);
    // a late answer for the id that timed out settles nothing and throws nothing
    expect(() => f.deliver({ channel: APP_API_CHANNEL, id, ok: true })).not.toThrow();
  });

  it("request() waits on the person: no timeout, it resolves when the window answers", async () => {
    const f = build();
    const p = f.api.permissions.request(["notifications"]);
    let settled = false;
    void p.then(() => (settled = true), () => (settled = true));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(settled).toBe(false);
    f.deliver({ channel: APP_API_CHANNEL, id: f.last().id, ok: true, value: { notifications: "granted" } });
    await expect(p).resolves.toEqual({ notifications: "granted" });
  });
});

describe("what the script sends", () => {
  it("state() asks for the whole map, state(name) for one", () => {
    const f = build();
    void f.api.permissions.state().catch(() => undefined);
    expect(f.last().method).toBe("permissions.state");
    expect(f.last().args).toEqual({});
    void f.api.permissions.state("notifications").catch(() => undefined);
    expect(f.last().args).toEqual({ name: "notifications" });
  });

  it("request() asks for everything declared, request(name) for one, request([…]) for those", () => {
    const f = build();
    void f.api.permissions.request().catch(() => undefined);
    expect(f.last().method).toBe("permissions.request");
    expect(f.last().args).toEqual({});
    void f.api.permissions.request("notifications").catch(() => undefined);
    expect(f.last().args).toEqual({ names: ["notifications"] });
    void f.api.permissions.request(["notifications", "overlay"]).catch(() => undefined);
    expect(f.last().args).toEqual({ names: ["notifications", "overlay"] });
  });

  it("show passes what the app gave, untouched — the strict check is the window's, so an extra key is not hidden here", () => {
    const f = build();
    void f.api.notification.show({ body: "hi", title: "boo" }).catch(() => undefined);
    expect(f.last()).toMatchObject({ method: "notification.show", args: { body: "hi", title: "boo" } });
    void f.api.notification.show().catch(() => undefined);
    expect(f.last()).toMatchObject({ method: "notification.show", args: undefined });
  });

  it("what can't be sent by postMessage rejects EINVAL and leaves no pending call", async () => {
    const f = build({
      postMessage: () => {
        throw new Error("DataCloneError");
      },
    });
    const e = (await f.api.notification.show({ body: "x", fn: () => 1 }).catch((x: unknown) => x)) as Error & { code?: string };
    expect(e.code).toBe("EINVAL");
    await vi.advanceTimersByTimeAsync(60_000);
  });
});

describe("where it posts", () => {
  it("never to \"*\": the script has no wildcard target, and every post names an origin it was built with", () => {
    expect(appApiClientSource([APP])).not.toMatch(/postMessage\([^)]*"\*"/);
    const f = build({ origins: DEV, referrer: "http://localhost:3000/desktop/x" });
    void f.api.permissions.state().catch(() => undefined);
    for (const call of f.postMessage.mock.calls) expect(DEV).toContain(call[1]);
  });

  it("with one origin, to it", () => {
    const f = build({ origins: [APP], referrer: "https://evil.example/", ancestorOrigins: ["https://evil.example"] });
    void f.api.permissions.state().catch(() => undefined);
    expect(f.postMessage.mock.calls[0]![1]).toBe(APP);
  });

  it("with several, to the ancestor origin the browser reports when it is one of them", () => {
    const f = build({ origins: DEV, ancestorOrigins: ["http://127.0.0.1:3000", "https://other.example"], referrer: "http://localhost:3000/x" });
    void f.api.permissions.state().catch(() => undefined);
    expect(f.postMessage.mock.calls[0]![1]).toBe("http://127.0.0.1:3000");
  });

  it("with several and no ancestor origins, to the origin of the referrer when it is one of them", () => {
    const f = build({ origins: DEV, referrer: "http://localhost:3000/en/desktop/abc?x=1" });
    void f.api.permissions.state().catch(() => undefined);
    expect(f.postMessage.mock.calls[0]![1]).toBe("http://localhost:3000");
  });

  it("with several and neither one among them (or no referrer, or a broken one), to the app origin", () => {
    for (const o of [{ referrer: "https://evil.example/" }, { ancestorOrigins: ["https://evil.example"] }, {}, { referrer: "not a url" }, { ancestorOrigins: [] as string[] }]) {
      const f = build({ origins: DEV, ...o });
      void f.api.permissions.state().catch(() => undefined);
      expect(f.postMessage.mock.calls[0]![1], JSON.stringify(o)).toBe(APP);
    }
  });
});

describe("manage() needs a gesture", () => {
  it("without a recent gesture rejects EPERM and posts nothing", async () => {
    const f = build();
    const e = (await f.api.permissions.manage().catch((x: unknown) => x)) as Error & { code?: string };
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("EPERM");
    expect(f.postMessage).not.toHaveBeenCalled();
  });

  it("with a click it posts, and the answer resolves it", async () => {
    const f = build();
    f.gesture("click");
    const p = f.api.permissions.manage();
    expect(f.last().method).toBe("permissions.manage");
    expect(f.last().args).toEqual({});
    f.deliver({ channel: APP_API_CHANNEL, id: f.last().id, ok: true });
    await expect(p).resolves.toBeUndefined();
  });

  it("a key press counts too, and each gesture opens it once", async () => {
    const f = build();
    f.gesture("keydown");
    void f.api.permissions.manage().catch(() => undefined);
    expect(f.postMessage).toHaveBeenCalledTimes(1);
    const again = (await f.api.permissions.manage().catch((x: unknown) => x)) as Error & { code?: string };
    expect(again.code).toBe("EPERM");
    expect(f.postMessage).toHaveBeenCalledTimes(1);
    f.gesture("click");
    void f.api.permissions.manage().catch(() => undefined);
    expect(f.postMessage).toHaveBeenCalledTimes(2);
  });

  it("a gesture older than 5 s does not count", async () => {
    const f = build();
    f.gesture("click");
    await vi.advanceTimersByTimeAsync(5_001);
    expect(((await f.api.permissions.manage().catch((x: unknown) => x)) as { code?: string }).code).toBe("EPERM");
    expect(f.postMessage).not.toHaveBeenCalled();
    f.gesture("click");
    await vi.advanceTimersByTimeAsync(4_900);
    void f.api.permissions.manage().catch(() => undefined);
    expect(f.postMessage).toHaveBeenCalledTimes(1);
  });

  it("an event the page made itself (not trusted) is not a gesture", async () => {
    const f = build();
    f.gesture("click", false);
    f.gesture("keydown", false);
    expect(((await f.api.permissions.manage().catch((x: unknown) => x)) as { code?: string }).code).toBe("EPERM");
    expect(f.postMessage).not.toHaveBeenCalled();
  });

  it("when the browser says the activation is over, a click it saw is not enough", async () => {
    const f = build({ userActivation: { isActive: false } });
    f.gesture("click");
    expect(((await f.api.permissions.manage().catch((x: unknown) => x)) as { code?: string }).code).toBe("EPERM");
    expect(f.postMessage).not.toHaveBeenCalled();
  });

  it("with no navigator.userActivation, the click or key it saw is what it has", () => {
    const f = build({ userActivation: null });
    f.gesture("click");
    void f.api.permissions.manage().catch(() => undefined);
    expect(f.postMessage).toHaveBeenCalledTimes(1);
  });

  it("a gesture is not asked of the other three methods", () => {
    const f = build();
    void f.api.permissions.state().catch(() => undefined);
    void f.api.permissions.request().catch(() => undefined);
    void f.api.notification.show({ body: "x" }).catch(() => undefined);
    expect(f.postMessage).toHaveBeenCalledTimes(3);
  });
});

describe("with no window to ask", () => {
  it("unframed, every method rejects ENOTSUP and nothing is posted", async () => {
    const f = build({ framed: false });
    f.gesture("click");
    const results = await Promise.all([
      f.api.permissions.state().catch((x: unknown) => x),
      f.api.permissions.request().catch((x: unknown) => x),
      f.api.permissions.manage().catch((x: unknown) => x),
      f.api.notification.show({ body: "x" }).catch((x: unknown) => x),
    ]);
    for (const e of results) expect((e as { code?: string }).code).toBe("ENOTSUP");
    expect(f.postMessage).not.toHaveBeenCalled();
  });

  it("in a real jsdom window, top level: it defines window.openlenApp and answers ENOTSUP", async () => {
    vi.useRealTimers();
    new Function("window", appApiClientSource([APP]))(window);
    const api = (window as unknown as { openlenApp: Api }).openlenApp;
    expect(typeof api.permissions.state).toBe("function");
    expect(((await api.permissions.state().catch((x: unknown) => x)) as { code?: string }).code).toBe("ENOTSUP");
    delete (window as unknown as { openlenApp?: Api }).openlenApp;
  });
});

describe("appApiClientSource", () => {
  it("refuses an origin that is not an origin: a wildcard, null, a path, a trailing slash, nothing at all", () => {
    for (const bad of [["*"], ["null"], [""], ["https://openlen.com/"], ["https://openlen.com/x"], ["openlen.com"], ["https://openlen.com", "*"], [], ["ftp://openlen.com"], ["https://open len.com"]]) {
      expect(() => appApiClientSource(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("takes the app origin and the localhost variants (with a port)", () => {
    for (const ok of [[APP], DEV, ["http://localhost"], ["https://openlen.com:8443"]]) expect(() => appApiClientSource(ok)).not.toThrow();
  });

  it("carries nothing of OpenLen but the origins it was built with", () => {
    const src = appApiClientSource([APP]);
    expect(src).toContain(JSON.stringify([APP]));
    expect(src).toContain(JSON.stringify(APP_API_CHANNEL));
    expect(src).not.toMatch(/cookie|localStorage|sessionStorage|token|authorization/i);
  });
});
