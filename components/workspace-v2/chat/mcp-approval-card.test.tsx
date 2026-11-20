// THE «CONECTAR» CARD (spec local 2026-11-06-conectores-mcp, §5.3): a server Len added to ~/.len/mcp.json waits for the
// person. The card names the host and every key it would send, warns in red when a key already goes to another host,
// asks for the keys that are missing, and approves exactly what it was drawn from.
import fs from "node:fs";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import type { McpApprovalCard } from "@/lib/mcp-connectors/approval-card";

import { McpApprovalCardView } from "./mcp-approval-card";
import { SIGN_IN_ERROR_KEYS, signInErrorKey } from "./sign-in-errors";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CARD = {
  server: "copy",
  host: "collector.example.net",
  headerNames: ["Authorization"],
  credentials: [
    { name: "NOTION_TOKEN", set: true, destinationHosts: ["collector.example.net"], otherHosts: ["mcp.notion.example.com"], firstTime: true },
    { name: "EXTRA", set: false, destinationHosts: ["collector.example.net"], otherHosts: [], firstTime: false },
  ],
  fingerprint: "fp1",
  version: 7,
};

async function render(card: McpApprovalCard = CARD) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(<McpApprovalCardView card={card} />));
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("McpApprovalCardView", () => {
  it("names the server, the host and each key it will send", async () => {
    await render();
    expect(document.body.textContent).toContain('mcpApproval.title {"server":"copy","host":"collector.example.net"}');
    expect(document.body.textContent).toContain('mcpApproval.sends {"name":"NOTION_TOKEN","host":"collector.example.net"}');
  });

  it("card warns when a credential is used by another host", async () => {
    await render();
    const warning = document.querySelector("[data-mcp-key-warning]");
    expect(warning?.textContent).toContain('mcpApproval.usedElsewhere {"name":"NOTION_TOKEN","hosts":"mcp.notion.example.com"}');
  });

  it("🔴 a stored key going to this host for the first time is warned even with no other host known", async () => {
    await render({ ...CARD, credentials: [{ name: "NOTION_TOKEN", set: true, destinationHosts: ["collector.example.net"], otherHosts: [], firstTime: true }] });
    const warning = document.querySelector("[data-mcp-key-warning]");
    expect(warning?.textContent).toContain('mcpApproval.firstTime {"name":"NOTION_TOKEN","host":"collector.example.net"}');
  });

  it("shows a field per missing key and sends it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: { status: "connected", tools: 4 } })));
    await render();
    const inputs = document.querySelectorAll("input");
    expect(inputs).toHaveLength(1);
    await act(async () => {
      const input = inputs[0] as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "secret-extra");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("mcpApproval.connect").click());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/mcp-connectors/copy/approve");
    expect(JSON.parse(String(init.body))).toEqual({ fingerprint: "fp1", version: 7, credentials: { EXTRA: "secret-extra" } });
    expect(document.body.textContent).toContain('mcpApproval.connected {"tools":4}');
    expect(document.body.textContent).not.toContain("secret-extra");
  });

  it("a change in between says so", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "changed" }), { status: 409 }));
    await render({ ...CARD, credentials: [] });
    await act(async () => button("mcpApproval.connect").click());
    expect(document.body.textContent).toContain("mcpApproval.changed");
  });

  it("No dismisses without a request", async () => {
    await render();
    await act(async () => button("mcpApproval.no").click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("mcpApproval.dismissed");
  });

  it("the card names where you sign in (first, lapsed, scope)", async () => {
    await render({
      ...CARD,
      credentials: [],
      version: 0,
      oauth: { issuerHost: "accounts.google.com", reason: "first" },
    });
    expect(document.body.textContent).toContain('mcpApproval.signInAt {"issuer":"accounts.google.com"}');

    await render({
      ...CARD,
      credentials: [],
      version: 0,
      oauth: { issuerHost: "accounts.google.com", reason: "lapsed" },
    });
    expect(document.body.textContent).toContain('mcpApproval.signInAgainAt {"issuer":"accounts.google.com"}');

    await render({
      ...CARD,
      credentials: [],
      version: 0,
      oauth: { issuerHost: "accounts.google.com", reason: "scope" },
    });
    expect(document.body.textContent).toContain('mcpApproval.morePermissionsAt {"issuer":"accounts.google.com"}');
  });

  it("🔴 a card for a new OAuth server is one tap: opens the window synchronously, approves, and starts OAuth", async () => {
    const popup = { closed: false, location: { href: "about:blank" }, close() { this.closed = true; } };
    const openSpy = vi.fn(() => popup);
    window.open = openSpy as unknown as typeof window.open;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: { status: "needs-auth", tools: 0 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" })));

    await render({
      server: "cal",
      host: "calendarmcp.googleapis.com",
      headerNames: [],
      credentials: [],
      fingerprint: "fp-cal",
      version: 4,
      oauth: { issuerHost: "accounts.google.com", reason: "first" },
    });

    await act(async () => {
      button("mcpApproval.connect").click();
      // Synchronously inside the click handler, before fetch resolves:
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/mcp-connectors/cal/approve", "/api/mcp-connectors/cal/oauth"]);
    expect(popup.location.href).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=s1");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "openlen:mcp-oauth", server: "cal", ok: true },
        }),
      );
    });
    expect(document.body.textContent).toContain("mcpApproval.oauthConnected");
  });

  it("start fails closes the window and says why", async () => {
    const popup = { closed: false, location: { href: "about:blank" }, close() { this.closed = true; } };
    window.open = vi.fn(() => popup) as unknown as typeof window.open;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "no_client", detail: "set oauth.clientId in mcp.json" }), { status: 422 }));

    await render({
      server: "cal",
      host: "calendarmcp.googleapis.com",
      headerNames: [],
      credentials: [],
      fingerprint: "fp-cal",
      version: 0,
      oauth: { issuerHost: "accounts.google.com", reason: "first" },
    });

    await act(async () => {
      button("mcpApproval.connect").click();
    });
    expect(popup.closed).toBe(true);
    expect(document.body.textContent).toContain("mcpApproval.errors.noClient");
    expect(document.body.textContent).toContain("set oauth.clientId in mcp.json");
  });
});

// Final review, F3 (spec §10.2): the start checks the sign-in host this card named. When it moved, the card names the new
// host and says the page changed; the next tap is checked against what the person now sees.
describe("🔴 a sign-in page that moved", () => {
  const SIGN_IN: McpApprovalCard = {
    server: "cal",
    host: "calendarmcp.googleapis.com",
    headerNames: [],
    credentials: [],
    fingerprint: "fp-cal",
    version: 0,
    oauth: { issuerHost: "accounts.google.com", reason: "first" },
  };
  const AUTH_URL = "https://login.example.org/authorize?state=s1";
  const fakePopup = () => ({ closed: false, opener: {} as unknown, location: { href: "about:blank" }, close() { this.closed = true; } });
  const sentBodies = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/oauth")).map((c) => JSON.parse(String((c[1] as RequestInit).body)));
  const signInLine = () => document.querySelector("[data-mcp-sign-in]")?.textContent ?? "";

  it("the start is told the host the card named; a move names the new host, says so, and the next tap checks that one", async () => {
    const popup = fakePopup();
    window.open = vi.fn(() => popup) as unknown as typeof window.open;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "issuer_changed", issuerHost: "login.example.org" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: AUTH_URL })));
    await render(SIGN_IN);
    await act(async () => button("mcpApproval.connect").click());
    expect(popup.closed).toBe(true);
    expect(document.body.textContent).toContain("mcpApproval.errors.issuerChanged");
    expect(signInLine()).toBe('mcpApproval.signInAt {"issuer":"login.example.org"}');

    popup.closed = false;
    await act(async () => button("mcpApproval.tryAgain").click());
    expect(sentBodies()).toEqual([{ issuerHost: "accounts.google.com" }, { issuerHost: "login.example.org" }]);
    expect(popup.location.href).toBe(AUTH_URL);
  });

  it("a card that named no host tells the start so (null), and the way back's move is shown too", async () => {
    window.open = vi.fn(() => fakePopup()) as unknown as typeof window.open;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: AUTH_URL })));
    await render({ ...SIGN_IN, oauth: { issuerHost: null, reason: "lapsed" } });
    await act(async () => button("mcpApproval.connect").click());
    expect(sentBodies()).toEqual([{ issuerHost: null }]);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "openlen:mcp-oauth", server: "cal", ok: false, reason: "issuer_changed", issuerHost: "login.example.org" },
        }),
      );
    });
    expect(document.body.textContent).toContain("mcpApproval.errors.issuerChanged");
    expect(signInLine()).toBe('mcpApproval.signInAgainAt {"issuer":"login.example.org"}');
  });
});

// Final review, F4 (spec §10.5): a server Len added without an `oauth` block may sign in — the card can't know before it
// is approved. The approval answers where, the card becomes a sign-in card, and its «Conectar» opens the window on that
// second click (one opened after an await would be blocked).
describe("🔴 an approved server that turns out to sign in", () => {
  const LEN_ADDED: McpApprovalCard = {
    server: "linear",
    host: "mcp.linear.app",
    headerNames: [],
    credentials: [{ name: "EXTRA", set: false, destinationHosts: ["mcp.linear.app"], otherHosts: [], firstTime: false }],
    fingerprint: "fp-linear",
    version: 5,
  };
  const AUTH_URL = "https://linear.app/oauth/authorize?state=s1";
  const fakePopup = () => ({ closed: false, opener: {} as unknown, location: { href: "about:blank" }, close() { this.closed = true; } });
  const needsAuth = (signIn: unknown) => new Response(JSON.stringify({ state: { status: "needs-auth", tools: 0, error: "needs authentication", signIn } }));
  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

  it("offers «Conectar» naming the host the mount found, never «Failed»; that click opens the window and starts without approving again", async () => {
    const popup = fakePopup();
    const openSpy = vi.fn(() => popup);
    window.open = openSpy as unknown as typeof window.open;
    fetchMock
      .mockResolvedValueOnce(needsAuth({ issuerHost: "linear.app", reason: "first" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationUrl: AUTH_URL })));
    await render(LEN_ADDED);
    await act(async () => button("mcpApproval.connect").click());
    expect(openSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("mcpApproval.failed");
    expect(document.querySelector("[data-mcp-sign-in]")?.textContent).toBe('mcpApproval.signInAt {"issuer":"linear.app"}');
    expect(document.querySelectorAll("input")).toHaveLength(0);

    await act(async () => {
      button("mcpApproval.connect").click();
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    expect(urls()).toEqual(["/api/mcp-connectors/linear/approve", "/api/mcp-connectors/linear/oauth"]);
    expect(JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body))).toEqual({ issuerHost: "linear.app" });
    expect(popup.location.href).toBe(AUTH_URL);
  });

  it("a host the answer doesn't name is the server's own sign-in page", async () => {
    fetchMock.mockResolvedValueOnce(needsAuth({ issuerHost: "<b>x</b>", reason: "weird" }));
    await render(LEN_ADDED);
    await act(async () => button("mcpApproval.connect").click());
    expect(document.querySelector("[data-mcp-sign-in]")?.textContent).toBe("mcpApproval.signInOnServerPage");
  });

  it("an approval inside the one-tap sign-in whose mount already connects closes the window and says connected", async () => {
    const popup = fakePopup();
    window.open = vi.fn(() => popup) as unknown as typeof window.open;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: { status: "connected", tools: 3 } })));
    await render({ ...LEN_ADDED, credentials: [], oauth: { issuerHost: "linear.app", reason: "first" } });
    await act(async () => button("mcpApproval.connect").click());
    expect(popup.closed).toBe(true);
    expect(urls()).toEqual(["/api/mcp-connectors/linear/approve"]);
    expect(document.body.textContent).toContain('mcpApproval.connected {"tools":3}');
  });
});

// Review fix OB1: the card says where each thing really goes. A client secret goes to the authorization server's token
// endpoint, a header's key to the MCP server, and a sign-in that nobody knows the page of is said to be on the server's
// own sign-in page — never on the MCP server's host, which is where the tools are.
describe("🔴 the card names the host a key and a sign-in really go to", () => {
  const OAUTH_CARD: McpApprovalCard = {
    server: "cal",
    host: "calendarmcp.googleapis.com",
    headerNames: [],
    credentials: [],
    fingerprint: "fp-cal",
    version: 0,
    oauth: { issuerHost: "accounts.google.com", reason: "first" },
  };
  const line = (selector: string) => document.querySelector(selector)?.textContent ?? "";

  it("a client secret is sent to the authorization server's hosts, not to the MCP host", async () => {
    await render({
      ...OAUTH_CARD,
      credentials: [{ name: "CLIENT_SECRET", set: true, destinationHosts: ["auth.example.com", "login.example.com"], otherHosts: [], firstTime: true }],
    });
    const sends = line("[data-mcp-sends]");
    expect(sends).toContain('mcpApproval.sends {"name":"CLIENT_SECRET","host":"auth.example.com, login.example.com"}');
    expect(sends).not.toContain("calendarmcp.googleapis.com");
    // The first-time warning names the same hosts (the server computed it for them).
    expect(line("[data-mcp-key-warning]")).toContain('"host":"auth.example.com, login.example.com"');
    expect(line("[data-mcp-key-warning]")).not.toContain("calendarmcp.googleapis.com");
  });

  it("the «used elsewhere» warning is the server's measure for that credential", async () => {
    await render({
      ...OAUTH_CARD,
      credentials: [{ name: "CLIENT_SECRET", set: true, destinationHosts: ["auth.example.com"], otherHosts: ["old.example.org"], firstTime: true }],
    });
    expect(line("[data-mcp-key-warning]")).toContain('mcpApproval.usedElsewhere {"name":"CLIENT_SECRET","hosts":"old.example.org"}');
  });

  it("a key whose hosts the card doesn't know, on an OAuth card, is not said to go to the MCP host", async () => {
    await render({ ...OAUTH_CARD, credentials: [{ name: "CLIENT_SECRET", set: true, destinationHosts: [], otherHosts: [], firstTime: false }] });
    expect(line("[data-mcp-sends]")).toContain('mcpApproval.sendsToSignIn {"name":"CLIENT_SECRET"}');
    expect(line("[data-mcp-sends]")).not.toContain("calendarmcp.googleapis.com");
  });

  it("an older card with no destination hosts and no sign-in still names the MCP host, as it did", async () => {
    await render({ ...CARD, credentials: [{ name: "NOTION_TOKEN", set: true, destinationHosts: [], otherHosts: [], firstTime: false }] });
    expect(line("[data-mcp-sends]")).toContain('mcpApproval.sends {"name":"NOTION_TOKEN","host":"collector.example.net"}');
  });

  it("without a known sign-in host, it says the server's own sign-in page and never the MCP host", async () => {
    const expected = { first: "mcpApproval.signInOnServerPage", lapsed: "mcpApproval.signInAgainOnServerPage", scope: "mcpApproval.morePermissionsOnServerPage" } as const;
    for (const reason of ["first", "lapsed", "scope"] as const) {
      await render({ ...OAUTH_CARD, oauth: { issuerHost: null, reason } });
      const text = line("[data-mcp-sign-in]");
      expect(text).toBe(expected[reason]);
      expect(text).not.toContain("calendarmcp.googleapis.com");
      act(() => root!.unmount());
      root = null;
    }
  });

  it("a remote string is drawn as text, never as markup", async () => {
    const hostile = "<img src=x onerror=document.title=1>";
    await render({
      ...OAUTH_CARD,
      oauth: { issuerHost: hostile, reason: "first" },
      credentials: [{ name: "K", set: true, destinationHosts: [hostile], otherHosts: [hostile], firstTime: false }],
    });
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.textContent).toContain(hostile);
  });
});

// Review fix OB2: approving bumps the file's version, so a retry that approved again would answer «changed». The card
// remembers that the approval went through; a failed sign-in leaves a button to try again and says why in words.
describe("🔴 trying again after a sign-in that didn't finish", () => {
  const NEEDS_APPROVAL: McpApprovalCard = {
    server: "cal",
    host: "calendarmcp.googleapis.com",
    headerNames: [],
    credentials: [{ name: "EXTRA", set: false, destinationHosts: ["calendarmcp.googleapis.com"], otherHosts: [], firstTime: false }],
    fingerprint: "fp-cal",
    version: 4,
    oauth: { issuerHost: "accounts.google.com", reason: "first" },
  };
  const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?state=s1";
  const fakePopup = () => ({ closed: false, opener: {} as unknown, location: { href: "about:blank" }, close() { this.closed = true; } });
  const approveOk = () => new Response(JSON.stringify({ state: { status: "needs-auth", tools: 0 } }));
  const startOk = () => new Response(JSON.stringify({ authorizationUrl: AUTH_URL }));
  const servers = (...rows: { name: string; status: string }[]) => new Response(JSON.stringify({ available: true, servers: rows }));
  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

  it("closing the window after the approval went through retries without approving again", async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    window.open = vi.fn(() => popup) as unknown as typeof window.open;
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/approve") ? approveOk() : url.endsWith("/oauth") ? startOk() : servers({ name: "cal", status: "needs-auth" }),
    );
    await render(NEEDS_APPROVAL);
    await act(async () => button("mcpApproval.connect").click());
    expect(urls()).toEqual(["/api/mcp-connectors/cal/approve", "/api/mcp-connectors/cal/oauth"]);

    // The person closes the window a few seconds in, before finishing. A `closed` seen right after the window left for the
    // provider is its COOP (final review M2); a later one is the person (R2): one look at OpenLen and the card is a tap that
    // can be made again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // Back to a tap that can be made again, and the key field it already sent is gone.
    expect(document.querySelectorAll("input")).toHaveLength(0);
    popup.closed = false;
    await act(async () => button("mcpApproval.connect").click());
    expect(urls().filter((u) => u.endsWith("/approve"))).toHaveLength(1);
    expect(urls().filter((u) => u.endsWith("/oauth"))).toHaveLength(2);
    expect(document.body.textContent).not.toContain("mcpApproval.changed");
  });

  // R2 (final review, residual): a person who closes the window to cancel gets the button back a moment later, not ten
  // minutes later; a close that wasn't one (the provider's COOP seen late) still shows the connection when it comes through;
  // and the wait goes with the card.
  describe("🔴 closing the window to cancel", () => {
    const SIGN_IN: McpApprovalCard = { ...NEEDS_APPROVAL, version: 0, credentials: [] };
    const begin = async (rows: Response = servers({ name: "cal", status: "needs-auth" })) => {
      vi.useFakeTimers();
      const popup = fakePopup();
      window.open = vi.fn(() => popup) as unknown as typeof window.open;
      fetchMock.mockImplementation(async (url: string) => (url.endsWith("/oauth") ? startOk() : rows.clone()));
      await render(SIGN_IN);
      await act(async () => button("mcpApproval.connect").click());
      expect(button("mcpApproval.connect").disabled).toBe(true);
      return popup;
    };
    const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    const sawList = () => urls().filter((u) => u === "/api/mcp-connectors");

    it("a window closed a few seconds in: the button is enabled again after one refetch, not ten minutes later", async () => {
      const popup = await begin();
      await advance(3_000);
      popup.closed = true;
      await advance(300);
      expect(sawList()).toHaveLength(1);
      expect(button("mcpApproval.connect").disabled).toBe(false);
      expect(document.body.textContent).not.toContain("mcpApproval.errors");
    });

    it("a window closed a few seconds in, but the server is connected: the card says connected", async () => {
      const popup = await begin(servers({ name: "cal", status: "connected" }));
      await advance(3_000);
      popup.closed = true;
      await advance(300);
      expect(document.body.textContent).toContain("mcpApproval.oauthConnected");
    });

    it("🔴 a close that wasn't one: the way back still shows the connection afterwards", async () => {
      const popup = await begin();
      await advance(3_000);
      popup.closed = true;
      await advance(300);
      expect(button("mcpApproval.connect").disabled).toBe(false);
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data: { type: "openlen:mcp-oauth", server: "cal", ok: true } }));
      });
      expect(document.body.textContent).toContain("mcpApproval.oauthConnected");
    });

    it("🔴 the card going away clears the wait: no timer, no listener left", async () => {
      await begin();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const listening = vi.spyOn(window, "removeEventListener");
      act(() => root!.unmount());
      root = null;
      expect(vi.getTimerCount()).toBe(0);
      expect(listening).toHaveBeenCalledWith("message", expect.any(Function));
    });

    it("a new tap after a close takes the wait over: the old one leaves nothing behind", async () => {
      const popup = await begin();
      await advance(3_000);
      popup.closed = true;
      await advance(300);
      popup.closed = false;
      await act(async () => button("mcpApproval.connect").click());
      expect(button("mcpApproval.connect").disabled).toBe(true);
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data: { type: "openlen:mcp-oauth", server: "cal", ok: true } }));
      });
      expect(document.body.textContent).toContain("mcpApproval.oauthConnected");
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("a blocked window says so in words, keeps «Try again» and points at Tools", async () => {
    window.open = vi.fn(() => null) as unknown as typeof window.open;
    await render(NEEDS_APPROVAL);
    await act(async () => button("mcpApproval.connect").click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("mcpApproval.errors.popupBlocked");
    expect(document.body.textContent).not.toContain("popup_blocked");
    expect(button("mcpApproval.tryAgain")).toBeTruthy();
    const link = document.querySelector<HTMLAnchorElement>("[data-mcp-open-connectors]");
    expect(link?.getAttribute("href")).toBe("/new?view=tools");
    expect(link?.textContent).toBe("mcpApproval.openConnectors");
  });

  it("a start that fails after the approval keeps it: «Try again» goes straight to the start", async () => {
    const popup = fakePopup();
    window.open = vi.fn(() => popup) as unknown as typeof window.open;
    fetchMock
      .mockResolvedValueOnce(approveOk())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "no_client", detail: "set oauth.clientId in mcp.json" }), { status: 422 }))
      .mockResolvedValueOnce(startOk());
    await render(NEEDS_APPROVAL);
    await act(async () => button("mcpApproval.connect").click());
    expect(popup.closed).toBe(true);
    expect(document.body.textContent).toContain("mcpApproval.errors.noClient");
    expect(document.body.textContent).toContain("set oauth.clientId in mcp.json");
    expect(document.body.textContent).not.toContain("no_client");
    expect(document.querySelectorAll("input")).toHaveLength(0);

    popup.closed = false;
    await act(async () => button("mcpApproval.tryAgain").click());
    expect(urls()).toEqual(["/api/mcp-connectors/cal/approve", "/api/mcp-connectors/cal/oauth", "/api/mcp-connectors/cal/oauth"]);
    expect(popup.location.href).toBe(AUTH_URL);
  });

  it("a code it doesn't know is never shown: the generic sentence stands in", async () => {
    window.open = vi.fn(() => fakePopup()) as unknown as typeof window.open;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "weird_code_123" }), { status: 500 }));
    await render({ ...NEEDS_APPROVAL, version: 0, credentials: [] });
    await act(async () => button("mcpApproval.connect").click());
    expect(document.body.textContent).toContain("mcpApproval.errors.failed");
    expect(document.body.textContent).not.toContain("weird_code_123");
  });

  it("a mount that fails (no OAuth) points at Tools too, and shows what the server said", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: { status: "failed", error: "HTTP 500" } })));
    await render({ ...CARD, credentials: [] });
    await act(async () => button("mcpApproval.connect").click());
    expect(document.body.textContent).toContain('mcpApproval.failed {"error":"HTTP 500"}');
    expect(document.querySelector("[data-mcp-open-connectors]")).not.toBeNull();
  });
});

// Every code a sign-in can end with has a sentence in the person's language (never the code itself).
describe("signInErrorKey", () => {
  const LOCALES = ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"];
  const messages = (locale: string) =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", locale, "panelsChat.json"), "utf8")) as { mcpApproval: Record<string, string> & { errors: Record<string, string> } };

  it("maps every code the start, the way back and the popup can produce", () => {
    const codes = [
      "popup_blocked", "sign_in_url_refused", "not_approved", "no_client", "unreachable", "expired", "used", "unknown",
      "issuer_changed", "exchange_failed", "off", "unauthorized", "not_found", "config_unreadable", "wrong_browser", "other_account",
    ];
    for (const code of codes) expect(signInErrorKey(code), code).not.toBe("failed");
    expect(signInErrorKey("whatever")).toBe("failed");
    expect(signInErrorKey("500")).toBe("failed");
    expect(signInErrorKey("")).toBe("failed");
  });

  it("has a translation of each sentence in all ten languages, with no placeholder left in it", () => {
    for (const locale of LOCALES) {
      const errors = messages(locale).mcpApproval.errors;
      for (const key of SIGN_IN_ERROR_KEYS) {
        expect(typeof errors[key] === "string" && errors[key]!.trim().length > 0, `${locale}.${key}`).toBe(true);
        expect(errors[key], `${locale}.${key}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("has the card's new texts in all ten languages", () => {
    for (const locale of LOCALES) {
      const m = messages(locale).mcpApproval;
      for (const key of ["signInOnServerPage", "signInAgainOnServerPage", "morePermissionsOnServerPage", "sendsToSignIn", "tryAgain", "openConnectors"]) {
        expect(typeof m[key] === "string" && m[key]!.trim().length > 0, `${locale}.${key}`).toBe(true);
      }
      expect(m.sendsToSignIn, locale).toContain("{name}");
    }
  });
});
