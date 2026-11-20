// «CONECTORES» ON THE HERRAMIENTAS PAGE (spec local 2026-11-06-conectores-mcp, §5.7): DeepSeek's Settings → MCP, for one
// person. It lists each server with its status, probes one, adds one with a key, and never shows a key back.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

const signIn = vi.hoisted(() => ({
  result: "connected" as "connected" | "closed" | "aborted" | { error: string; detail?: string },
  calls: [] as string[],
  opts: [] as { signal?: AbortSignal; onLate?: () => void }[],
}));
vi.mock("../chat/open-sign-in", async (orig) => ({
  ...(await orig<typeof import("../chat/open-sign-in")>()),
  openSignIn: async (server: string, opts: { signal?: AbortSignal; onLate?: () => void } = {}) => {
    signIn.calls.push(server);
    signIn.opts.push(opts);
    return signIn.result;
  },
}));

import { ConnectorsSection } from "./connectors-section";

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

const VIEW = {
  available: true,
  version: 3,
  servers: [
    { name: "notion", host: "mcp.notion.example.com", enabled: true, approved: true, status: "connected", tools: 12, headers: ["Authorization"] },
    { name: "linear", host: "mcp.linear.example.com", enabled: true, approved: true, status: "waiting-credentials", tools: 0, headers: ["Authorization"], error: "missing: LINEAR_KEY" },
  ],
  credentials: [{ name: "NOTION_AUTHORIZATION", updatedAt: "2026-11-06T10:00:00.000Z" }],
};
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function render() {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(<ConnectorsSection />));
  await act(async () => {});
}
const button = (text: string, within: ParentNode = document) => [...within.querySelectorAll("button")].find((b) => b.textContent === text)!;
async function type(input: Element, value: string) {
  await act(async () => {
    const el = input as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ConnectorsSection", () => {
  it("renders nothing when the connectors are off", async () => {
    fetchMock.mockResolvedValue(ok({ available: false }));
    await render();
    expect(document.querySelector("[data-connectors]")).toBeNull();
  });

  it("lists servers with their status", async () => {
    fetchMock.mockResolvedValue(ok(VIEW));
    await render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("notion");
    expect(text).toContain('tools.connectors.status.connected {"tools":12}');
    expect(text).toContain('tools.connectors.status.waiting {"names":"LINEAR_KEY"}');
    expect(text).toContain("NOTION_AUTHORIZATION");
  });

  it("Probar shows the tools or the error", async () => {
    fetchMock.mockResolvedValueOnce(ok(VIEW)).mockResolvedValueOnce(ok({ ok: true, serverInfo: { name: "n", version: "1" }, tools: ["search", "create_page"], problems: [] }));
    await render();
    const row = document.querySelector('[data-connector="notion"]')!;
    await act(async () => button("tools.connectors.probe", row).click());
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/mcp-connectors/notion/probe");
    expect(row.textContent).toContain('tools.connectors.probeOk {"tools":"search, create_page"}');
    fetchMock.mockResolvedValueOnce(ok({ ok: false, stage: "connect", error: "refused" }));
    await act(async () => button("tools.connectors.probe", row).click());
    expect(row.textContent).toContain('tools.connectors.probeFailed {"error":"refused"}');
  });

  it("adding a server with a key never echoes the key", async () => {
    fetchMock.mockResolvedValueOnce(ok(VIEW)).mockResolvedValueOnce(ok({ server: { name: "shop" } })).mockResolvedValueOnce(ok(VIEW));
    await render();
    await act(async () => button("tools.connectors.add").click());
    const form = document.querySelector("[data-connector-form]")!;
    const [name, url, header, value] = [...form.querySelectorAll("input:not([type=checkbox])")];
    await type(name!, "shop");
    await type(url!, "https://mcp.shop.example.com/mcp");
    await type(header!, "Authorization");
    await type(value!, "Bearer shpat_secret");
    await act(async () => (form.querySelector("input[type=checkbox]") as HTMLInputElement).click());
    await act(async () => button("tools.connectors.save", form).click());
    const [url2, init] = fetchMock.mock.calls[1]!;
    expect(url2).toBe("/api/mcp-connectors/shop");
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://mcp.shop.example.com/mcp", headers: {}, secretHeaders: { Authorization: "Bearer shpat_secret" }, version: 3 });
    expect(document.body.textContent).not.toContain("shpat_secret");
    expect((document.body.innerHTML.match(/shpat_secret/g) ?? []).length).toBe(0);
  });

  it("needs-auth shows Connect and connected with OAuth shows Disconnect (calling DELETE /oauth)", async () => {
    const viewWithOAuth = {
      ...VIEW,
      servers: [
        { name: "cal-pending", host: "calendarmcp.googleapis.com", url: "https://calendarmcp.googleapis.com/mcp/v1", enabled: true, approved: true, status: "needs-auth", tools: 0, headers: [], oauth: true },
        { name: "cal-live", host: "calendarmcp.googleapis.com", url: "https://calendarmcp.googleapis.com/mcp/v1", enabled: true, approved: true, status: "connected", tools: 6, headers: [], oauth: true },
      ],
    };
    fetchMock.mockResolvedValueOnce(ok(viewWithOAuth)).mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(ok(viewWithOAuth));
    await render();
    const pendingRow = document.querySelector('[data-connector="cal-pending"]')!;
    const liveRow = document.querySelector('[data-connector="cal-live"]')!;
    expect(button("tools.connectors.connect", pendingRow)).toBeTruthy();
    const disconnectBtn = button("tools.connectors.disconnect", liveRow);
    expect(disconnectBtn).toBeTruthy();
    await act(async () => disconnectBtn.click());
    expect(fetchMock.mock.calls[1]).toEqual(["/api/mcp-connectors/cal-live/oauth", expect.objectContaining({ method: "DELETE" })]);
  });

  // Review fix OB3/OB2: the window may close with the connection already made (the way back was cut), so the list is read
  // again whatever the window said; and a sign-in that failed says why in words, never a code.
  describe("the «Connect» button", () => {
    const pending = {
      ...VIEW,
      servers: [{ name: "cal", host: "calendarmcp.googleapis.com", url: "https://calendarmcp.googleapis.com/mcp/v1", enabled: true, approved: true, status: "needs-auth", tools: 0, headers: [], oauth: true }],
    };
    const connect = async () => act(async () => button("tools.connectors.connect", document.querySelector('[data-connector="cal"]')!).click());
    beforeEach(() => {
      signIn.calls.length = 0;
      signIn.opts.length = 0;
      fetchMock.mockImplementation(async () => ok(pending));
    });

    it("🔴 reads the list again when the window closed with no word", async () => {
      signIn.result = "closed";
      await render();
      const before = fetchMock.mock.calls.length;
      await connect();
      expect(signIn.calls).toEqual(["cal"]);
      expect(fetchMock.mock.calls.length).toBe(before + 1);
      expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/mcp-connectors");
    });

    it("reads the list again when it connected", async () => {
      signIn.result = "connected";
      await render();
      const before = fetchMock.mock.calls.length;
      await connect();
      expect(fetchMock.mock.calls.length).toBe(before + 1);
    });

    it("🔴 says in words why it failed, and never shows the code", async () => {
      signIn.result = { error: "popup_blocked" };
      await render();
      await connect();
      const row = document.querySelector('[data-connector="cal"]')!;
      expect(row.textContent).toContain("mcpApproval.errors.popupBlocked");
      expect(row.textContent).not.toContain("popup_blocked");
    });

    it("an unknown code is the generic sentence, and a useful detail comes with it", async () => {
      signIn.result = { error: "weird_123" };
      await render();
      await connect();
      expect(document.body.textContent).toContain("mcpApproval.errors.failed");
      expect(document.body.textContent).not.toContain("weird_123");
      signIn.result = { error: "no_client", detail: "set oauth.clientId in mcp.json" };
      await connect();
      expect(document.body.textContent).toContain("mcpApproval.errors.noClient");
      expect(document.body.textContent).toContain("set oauth.clientId in mcp.json");
    });

    // R2: the wait belongs to this page. A newer tap and the page going away abort it, a wait a newer tap took over reads
    // nothing, and a success that comes after the person closed the window reads the list again.
    it("🔴 a wait a newer tap took over (aborted) answers nothing: the list is not read for it", async () => {
      signIn.result = "aborted";
      await render();
      const before = fetchMock.mock.calls.length;
      await connect();
      expect(fetchMock.mock.calls.length).toBe(before);
    });

    it("a sign-in that came through after the window was closed reads the list again (onLate)", async () => {
      signIn.result = "closed";
      await render();
      await connect();
      const before = fetchMock.mock.calls.length;
      await act(async () => signIn.opts.at(-1)!.onLate!());
      expect(fetchMock.mock.calls.length).toBe(before + 1);
      expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/mcp-connectors");
    });

    it("🔴 a new tap aborts the wait before it, and the page going away aborts the last one", async () => {
      signIn.result = "closed";
      await render();
      await connect();
      const first = signIn.opts.at(-1)!.signal!;
      expect(first.aborted).toBe(false);
      await connect();
      const second = signIn.opts.at(-1)!.signal!;
      expect(first.aborted).toBe(true);
      expect(second.aborted).toBe(false);
      act(() => root!.unmount());
      root = null;
      expect(second.aborted).toBe(true);
    });
  });
});
