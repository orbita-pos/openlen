// «CONECTORES» ON THE HERRAMIENTAS PAGE (spec local 2026-11-06-conectores-mcp, §5.7): DeepSeek's Settings → MCP, for one
// person. It lists each server with its status, probes one, adds one with a key, and never shows a key back.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
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
});
