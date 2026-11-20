// Opening the OAuth popup on a tap (spec local 2026-11-17-oauth-de-conectores-mcp, §10.5): `window.open` runs
// synchronously before any `await`, then `approve?.()`, then `start`, and the popup navigates to the provider's URL and
// waits for the way back — a `BroadcastChannel` (the provider's pages may have cut the opener off) or a `postMessage` —,
// or for the window to close, in which case the server's own state says whether it connected.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openSignIn, SignInError } from "./open-sign-in";

interface FakePopup {
  closed: boolean;
  opener: unknown;
  location: { href: string };
  close: () => void;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?state=s1";
const CHANNEL = "openlen:mcp-oauth";

let popup: FakePopup;
let navigations: { url: string; opener: unknown }[];
const openMock = vi.fn();
const fetchMock = vi.fn();

/** A same-origin channel by name, delivering at once to every other open instance (what the browser does, minus the
 *  asynchrony). */
class FakeChannel {
  static all: FakeChannel[] = [];
  private listeners = new Set<(e: { data: unknown }) => void>();
  closed = false;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) if (c !== this && c.name === this.name && !c.closed) for (const l of c.listeners) l({ data });
  }
  addEventListener(type: string, l: (e: { data: unknown }) => void) {
    if (type === "message") this.listeners.add(l);
  }
  removeEventListener(type: string, l: (e: { data: unknown }) => void) {
    if (type === "message") this.listeners.delete(l);
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  navigations = [];
  let href = "about:blank";
  const p: FakePopup = {
    closed: false,
    opener: window,
    location: {
      get href() {
        return href;
      },
      set href(v: string) {
        href = v;
        navigations.push({ url: v, opener: p.opener });
      },
    },
    close() {
      this.closed = true;
    },
  };
  popup = p;
  openMock.mockReset().mockReturnValue(popup);
  fetchMock.mockReset();
  FakeChannel.all = [];
  vi.stubGlobal("open", openMock);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  window.open = openMock as unknown as typeof window.open;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const message = (data: unknown, origin = window.location.origin) => window.dispatchEvent(new MessageEvent("message", { origin, data }));
const comeBack = (data: unknown) => new FakeChannel(CHANNEL).postMessage(data);
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const servers = (...rows: { name: string; status: string }[]) => new Response(JSON.stringify({ available: true, servers: rows }));

describe("openSignIn", () => {
  it("🔴 opens the window synchronously before awaiting approve or start", async () => {
    let releaseStart!: (url: string) => void;
    const startPromise = new Promise<string>((r) => {
      releaseStart = r;
    });
    const run = openSignIn("cal", { start: () => startPromise });
    // Before `start` even resolves, `window.open` has already been called.
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith("about:blank", "openlen-mcp-oauth", "popup,width=520,height=680");
    expect(popup.location.href).toBe("about:blank");

    releaseStart(AUTH_URL);
    await settle();
    expect(popup.location.href).toBe(AUTH_URL);

    message({ type: CHANNEL, server: "cal", ok: true });
    expect(await run).toBe("connected");
    expect(popup.closed).toBe(true);
  });

  it("🔴 cuts the window off from this tab before it goes to the provider (reverse tabnabbing)", async () => {
    const run = openSignIn("cal", { start: async () => AUTH_URL });
    await settle();
    expect(navigations).toEqual([{ url: AUTH_URL, opener: null }]);
    message({ type: CHANNEL, server: "cal", ok: true });
    await run;
  });

  it("start fails closes the window and returns the error", async () => {
    const result = await openSignIn("cal", {
      start: async () => {
        throw new Error("no_client");
      },
    });
    expect(result).toEqual({ error: "no_client" });
    expect(popup.closed).toBe(true);
  });

  it("a start that fails with a code and a detail returns both, apart", async () => {
    const result = await openSignIn("cal", {
      start: async () => {
        throw new SignInError("no_client", "set oauth.clientId in mcp.json");
      },
    });
    expect(result).toEqual({ error: "no_client", detail: "set oauth.clientId in mcp.json" });
    expect(popup.closed).toBe(true);
  });

  it("runs approve before start when provided, and closes if approve returns false", async () => {
    const order: string[] = [];
    const closedResult = await openSignIn("cal", {
      approve: async () => {
        order.push("approve");
        return false;
      },
      start: async () => {
        order.push("start");
        return AUTH_URL;
      },
    });
    expect(closedResult).toBe("closed");
    expect(order).toEqual(["approve"]);
    expect(popup.closed).toBe(true);
  });

  it("🔴 a blocked window (nothing opened) is an error and starts nothing", async () => {
    openMock.mockReturnValue(null);
    const start = vi.fn();
    const approve = vi.fn();
    expect(await openSignIn("cal", { start, approve })).toEqual({ error: "popup_blocked" });
    expect(start).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  describe("🔴 where it goes", () => {
    it("refuses an address that isn't https: closes the window, never navigates it", async () => {
      for (const url of ["http://accounts.google.com/auth", "javascript:alert(1)", "data:text/html,x", "about:blank", "//evil.example/x", "not a url", ""]) {
        popup.closed = false;
        navigations.length = 0;
        expect(await openSignIn("cal", { start: async () => url }), url).toEqual({ error: "sign_in_url_refused" });
        expect(popup.closed, url).toBe(true);
        expect(navigations, url).toEqual([]);
      }
    });

    it("takes the address of the object the directory route answers with", async () => {
      const run = openSignIn("google-calendar", { start: async () => ({ authorizationUrl: AUTH_URL, server: "google-calendar-2" }) });
      await settle();
      expect(popup.location.href).toBe(AUTH_URL);
      message({ type: CHANNEL, server: "google-calendar-2", ok: true });
      expect(await run).toBe("connected");
    });
  });

  describe("🔴 the way back through the page's message", () => {
    // A started sign-in, ready to hear the way back. (The promise is returned inside an object so awaiting this doesn't
    // wait for the sign-in itself.)
    const sign = async (server = "cal") => {
      popup.closed = false;
      const run = openSignIn(server, { start: async () => AUTH_URL });
      await settle();
      return { run };
    };

    it("ignores a message from another origin, another type, or another server, and keeps waiting", async () => {
      const run = openSignIn("cal", { start: async () => AUTH_URL });
      await settle();
      let done = false;
      void run.then(() => (done = true));
      message({ type: CHANNEL, server: "cal", ok: true }, "https://evil.example");
      message({ type: "something-else", server: "cal", ok: true });
      message({ server: "cal", ok: true });
      message("openlen:mcp-oauth");
      message(null);
      message({ type: CHANNEL, server: "other", ok: true });
      message({ type: CHANNEL, server: null, ok: true });
      await settle();
      expect(done).toBe(false);
      expect(popup.closed).toBe(false);
      message({ type: CHANNEL, server: "cal", ok: true });
      expect(await run).toBe("connected");
    });

    it("matches the server name `start` returned, not only the card's", async () => {
      const run = openSignIn("google-calendar", { start: async () => ({ authorizationUrl: AUTH_URL, server: "google-calendar-2" }) });
      await settle();
      message({ type: CHANNEL, server: "google-calendar", ok: true });
      let done = false;
      void run.then(() => (done = true));
      await settle();
      expect(done).toBe(false);
      message({ type: CHANNEL, server: "google-calendar-2", ok: true });
      expect(await run).toBe("connected");
    });

    it("the person said no: closed", async () => {
      const { run } = await sign();
      message({ type: CHANNEL, server: "cal", ok: false, reason: "denied" });
      expect(await run).toBe("closed");
      expect(popup.closed).toBe(true);
    });

    it("a failure carries its reason, and a reason that isn't a plain code is just «failed»", async () => {
      let { run } = await sign();
      message({ type: CHANNEL, server: "cal", ok: false, reason: "exchange_failed" });
      expect(await run).toEqual({ error: "exchange_failed" });
      ({ run } = await sign());
      message({ type: CHANNEL, server: null, ok: false, reason: "unknown" });
      expect(await run).toEqual({ error: "unknown" });
      ({ run } = await sign());
      message({ type: CHANNEL, server: "cal", ok: false, reason: "<b>no</b>" });
      expect(await run).toEqual({ error: "failed" });
      ({ run } = await sign());
      message({ type: CHANNEL, server: "cal", ok: false });
      expect(await run).toEqual({ error: "failed" });
    });

    it("a success must name the server it was for", async () => {
      const { run } = await sign();
      let done = false;
      void run.then(() => (done = true));
      message({ type: CHANNEL, ok: true });
      await settle();
      expect(done).toBe(false);
      message({ type: CHANNEL, server: "cal", ok: true });
      expect(await run).toBe("connected");
    });
  });

  describe("🔴 the way back through the broadcast channel", () => {
    it("finishes on the callback page's broadcast, closing the window and the channel", async () => {
      const run = openSignIn("cal", { start: async () => AUTH_URL });
      await settle();
      comeBack({ type: CHANNEL, server: "cal", ok: true });
      expect(await run).toBe("connected");
      expect(popup.closed).toBe(true);
      expect(FakeChannel.all.filter((c) => c.name === CHANNEL && c.closed).length).toBeGreaterThanOrEqual(1);
    });

    it("applies the same rules to it: wrong type, wrong server and a denial", async () => {
      let run = openSignIn("cal", { start: async () => AUTH_URL });
      await settle();
      let done = false;
      void run.then(() => (done = true));
      comeBack({ type: "x", server: "cal", ok: true });
      comeBack({ type: CHANNEL, server: "other", ok: true });
      await settle();
      expect(done).toBe(false);
      comeBack({ type: CHANNEL, server: "cal", ok: false, reason: "denied" });
      expect(await run).toBe("closed");

      popup.closed = false;
      run = openSignIn("cal", { start: async () => AUTH_URL });
      await settle();
      comeBack({ type: CHANNEL, server: "cal", ok: false, reason: "issuer_changed" });
      expect(await run).toEqual({ error: "issuer_changed" });
    });

    it("works with no BroadcastChannel in the browser (the message still does)", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const run = openSignIn("cal", { start: async () => AUTH_URL });
      await settle();
      message({ type: CHANNEL, server: "cal", ok: true });
      expect(await run).toBe("connected");
    });
  });

  describe("🔴 the window closing with no message", () => {
    it("asks OpenLen, and says «connected» when the server now is (the way back was cut)", async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(servers({ name: "other", status: "failed" }, { name: "cal", status: "connected" }));
      const run = openSignIn("cal", { start: async () => AUTH_URL });
      await vi.advanceTimersByTimeAsync(0);
      popup.closed = true;
      await vi.advanceTimersByTimeAsync(250);
      expect(await run).toBe("connected");
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp-connectors");
    });

    it("looks for the name `start` returned", async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(servers({ name: "google-calendar", status: "needs-auth" }, { name: "google-calendar-2", status: "connected" }));
      const run = openSignIn("google-calendar", { start: async () => ({ authorizationUrl: AUTH_URL, server: "google-calendar-2" }) });
      await vi.advanceTimersByTimeAsync(0);
      popup.closed = true;
      await vi.advanceTimersByTimeAsync(250);
      expect(await run).toBe("connected");
    });

    it("says «closed» when it still isn't connected, or the answer can't be read", async () => {
      vi.useFakeTimers();
      for (const answer of [servers({ name: "cal", status: "needs-auth" }), new Response("nope", { status: 500 }), new Error("offline")]) {
        popup.closed = false;
        if (answer instanceof Error) fetchMock.mockRejectedValue(answer);
        else fetchMock.mockResolvedValue(answer);
        const run = openSignIn("cal", { start: async () => AUTH_URL });
        await vi.advanceTimersByTimeAsync(0);
        popup.closed = true;
        await vi.advanceTimersByTimeAsync(250);
        expect(await run).toBe("closed");
      }
    });

    it("a message that arrives while it asks still wins", async () => {
      vi.useFakeTimers();
      let answer!: (r: Response) => void;
      fetchMock.mockReturnValue(new Promise<Response>((r) => (answer = r)));
      const run = openSignIn("cal", { start: async () => AUTH_URL });
      await vi.advanceTimersByTimeAsync(0);
      popup.closed = true;
      await vi.advanceTimersByTimeAsync(250);
      comeBack({ type: CHANNEL, server: "cal", ok: false, reason: "exchange_failed" });
      expect(await run).toEqual({ error: "exchange_failed" });
      answer(servers({ name: "cal", status: "connected" }));
      await vi.advanceTimersByTimeAsync(0);
    });
  });
});
