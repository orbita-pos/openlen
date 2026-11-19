// Opening the OAuth popup on a tap (spec local 2026-11-17-oauth-de-conectores-mcp, §10.5): `window.open` runs
// synchronously before any `await`, then `approve?.()`, then `start`, and the popup navigates to the provider's URL and
// waits for `postMessage` from OpenLen's origin (or the window closing).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openSignIn } from "./open-sign-in";

interface FakePopup {
  closed: boolean;
  location: { href: string };
  close: () => void;
}

let popup: FakePopup;
const openMock = vi.fn();

beforeEach(() => {
  popup = {
    closed: false,
    location: { href: "about:blank" },
    close() {
      this.closed = true;
    },
  };
  openMock.mockReset().mockReturnValue(popup);
  vi.stubGlobal("open", openMock);
  window.open = openMock as unknown as typeof window.open;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

    releaseStart("https://accounts.google.com/o/oauth2/v2/auth?state=s1");
    await Promise.resolve();
    await Promise.resolve();
    expect(popup.location.href).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=s1");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "openlen:mcp-oauth", server: "cal", ok: true },
      }),
    );
    expect(await run).toBe("connected");
    expect(popup.closed).toBe(true);
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

  it("runs approve before start when provided, and closes if approve returns false", async () => {
    const order: string[] = [];
    const closedResult = await openSignIn("cal", {
      approve: async () => {
        order.push("approve");
        return false;
      },
      start: async () => {
        order.push("start");
        return "https://accounts.google.com/auth";
      },
    });
    expect(closedResult).toBe("closed");
    expect(order).toEqual(["approve"]);
    expect(popup.closed).toBe(true);
  });
});
