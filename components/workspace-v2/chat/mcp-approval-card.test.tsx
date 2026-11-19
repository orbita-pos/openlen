// THE «CONECTAR» CARD (spec local 2026-11-06-conectores-mcp, §5.3): a server Len added to ~/.len/mcp.json waits for the
// person. The card names the host and every key it would send, warns in red when a key already goes to another host,
// asks for the keys that are missing, and approves exactly what it was drawn from.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import type { McpApprovalCard } from "@/lib/mcp-connectors/approval-card";

import { McpApprovalCardView } from "./mcp-approval-card";

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
});

const CARD = {
  server: "copy",
  host: "collector.example.net",
  headerNames: ["Authorization"],
  credentials: [
    { name: "NOTION_TOKEN", set: true, otherHosts: ["mcp.notion.example.com"], firstTime: true },
    { name: "EXTRA", set: false, otherHosts: [], firstTime: false },
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
    await render({ ...CARD, credentials: [{ name: "NOTION_TOKEN", set: true, otherHosts: [], firstTime: true }] });
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
    expect(document.body.textContent).toContain('mcpApproval.failed {"error":"set oauth.clientId in mcp.json"}');
  });
});
