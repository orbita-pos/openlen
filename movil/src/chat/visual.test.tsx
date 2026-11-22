// THE PHONE'S VISUAL FRAME (spec local 2026-11-22-visuales-de-verdad, §1–2): same protocol and host checks as the web
// (`createVisualFrameHost`), themed from `document.documentElement.dataset.theme` + `WORKSPACE_TOOL_THEME`, links opened
// via `plataforma.abrirNavegador` after confirmation, and srcdoc fallback when `/api/visual-frame-url` gives no host.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";

const m = vi.hoisted(() => ({
  abrirNavegador: vi.fn(async () => {}),
}));
vi.mock("../sesion/plataforma", () => ({
  plataforma: { abrirNavegador: m.abrirNavegador },
}));
vi.mock("use-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import { VisualDelChat } from "./visual";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FRAME_ORIGIN = "https://lienzo-visuals.openlen.app";
const widget = { title: "Gasto del mes", loadingMessages: ["Dibujando la gráfica"], code: "<p>hola</p>" };
const roots: Root[] = [];

function makeCliente(url: string | null = `${FRAME_ORIGIN}/`, ok = true) {
  const pedir = vi.fn(async () => (ok ? Response.json({ url }) : new Response(null, { status: 401 })));
  const cliente: ClienteDeOpenLen = { pedir, avisarAlCerrar: () => {} };
  return { cliente, pedir };
}

beforeEach(() => {
  m.abrirNavegador.mockClear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

async function mount(props: Partial<Parameters<typeof VisualDelChat>[0]> = {}, clienteArg?: ClienteDeOpenLen) {
  const { cliente, pedir } = clienteArg ? { cliente: clienteArg, pedir: vi.fn() } : makeCliente();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const render = async (p: Partial<Parameters<typeof VisualDelChat>[0]> = {}) => {
    await act(async () => {
      root.render(<VisualDelChat widgetId="widget_aaaa1111" widget={widget} final cliente={cliente} {...props} {...p} />);
    });
  };
  await render();
  const iframe = () => host.querySelector("iframe")!;
  const posted: unknown[] = [];
  const spy = () => vi.spyOn(iframe().contentWindow!, "postMessage").mockImplementation((msg: unknown) => void posted.push(msg));
  const fromFrame = (data: unknown, origin = FRAME_ORIGIN) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source: iframe().contentWindow }));
    });
  return { host, iframe, posted, spy, fromFrame, render, cliente, pedir };
}

describe("VisualDelChat", () => {
  it("loads the hosted frame from /api/visual-frame-url and caches it per client", async () => {
    const { cliente, pedir } = makeCliente(`${FRAME_ORIGIN}/`);
    const a = await mount({}, cliente);
    const b = await mount({ widgetId: "widget_bbbb2222" }, cliente);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith("/api/visual-frame-url");
    expect(a.iframe().getAttribute("src")).toBe(`${FRAME_ORIGIN}/`);
    expect(a.iframe().getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(a.iframe().getAttribute("title")).toBe('visualLabel {"title":"Gasto del mes"}');
    expect(b.iframe().getAttribute("src")).toBe(`${FRAME_ORIGIN}/`);
  });

  it("without a hosted url (null or error): falls back to srcdoc without allow-same-origin", async () => {
    const { cliente } = makeCliente(null, true);
    const a = await mount({}, cliente);
    expect(a.iframe().getAttribute("src")).toBeNull();
    expect(a.iframe().getAttribute("srcdoc")).toContain('http-equiv="Content-Security-Policy"');
    expect(a.iframe().getAttribute("sandbox")).toBe("allow-scripts");

    const { cliente: cErr } = makeCliente(null, false);
    const b = await mount({}, cErr);
    expect(b.iframe().getAttribute("src")).toBeNull();
    expect(b.iframe().getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("sends the phone's light/dark theme with WORKSPACE_TOOL_THEME tokens and follows data-theme live", async () => {
    const view = await mount({ final: false });
    view.spy();
    view.fromFrame({ kind: "ol-visual:ready" });
    expect(view.posted[0]).toMatchObject({ kind: "ol-visual:theme", theme: "light", tokens: WORKSPACE_TOOL_THEME.light });
    expect(view.posted[1]).toEqual({ kind: "ol-visual:render", code: "<p>hola</p>", final: false });

    await act(async () => {
      document.documentElement.dataset.theme = "dark";
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(view.posted.at(-1)).toMatchObject({ kind: "ol-visual:theme", theme: "dark", tokens: WORKSPACE_TOOL_THEME.dark });
  });

  it("a link asks with movil.visual texts, ignores non-http(s), and opens with plataforma.abrirNavegador", async () => {
    const view = await mount();
    view.fromFrame({ kind: "ol-visual:link", href: "javascript:alert(1)" });
    expect(view.host.textContent).not.toContain("visualLinkTitle");

    view.fromFrame({ kind: "ol-visual:link", href: "https://example.com/guia" });
    expect(view.host.textContent).toContain("visualLinkTitle");
    expect(view.host.textContent).toContain("https://example.com/guia");

    const cancelBtn = [...view.host.querySelectorAll("button")].find((b) => b.textContent === "visualLinkCancel")!;
    act(() => cancelBtn.click());
    expect(view.host.textContent).not.toContain("visualLinkTitle");
    expect(m.abrirNavegador).not.toHaveBeenCalled();

    view.fromFrame({ kind: "ol-visual:link", href: "https://example.com/guia" });
    const openBtn = [...view.host.querySelectorAll("button")].find((b) => b.textContent === "visualLinkOpen")!;
    act(() => openBtn.click());
    expect(m.abrirNavegador).toHaveBeenCalledWith("https://example.com/guia");
    expect(view.host.textContent).not.toContain("visualLinkTitle");
  });

  it("a prompt needs a recent tap into the frame and fires once; updateModelContext calls onState(widgetId, text) without a tap", async () => {
    const onPrompt = vi.fn();
    const onState = vi.fn();
    const view = await mount({ onPrompt, onState, widgetId: "widget_abcd1234" });

    view.fromFrame({ kind: "ol-visual:prompt", text: "demasiado pronto" });
    expect(onPrompt).not.toHaveBeenCalled();

    view.fromFrame({ kind: "ol-visual:context", text: "  3 of 5  " });
    expect(onState).toHaveBeenCalledWith("widget_abcd1234", "3 of 5");

    vi.spyOn(document, "activeElement", "get").mockReturnValue(view.iframe());
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    view.fromFrame({ kind: "ol-visual:prompt", text: "Listo" });
    view.fromFrame({ kind: "ol-visual:prompt", text: "otra vez" });
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt).toHaveBeenCalledWith("Listo");
  });

  it("shows loading messages while final is false and hides them once final", async () => {
    const view = await mount({ final: false });
    expect(view.host.textContent).toContain("Dibujando la gráfica");
    await view.render({ final: true });
    expect(view.host.textContent).not.toContain("Dibujando la gráfica");

    const fallback = await mount({ final: false, widget: { ...widget, loadingMessages: [] } });
    expect(fallback.host.textContent).toContain("visualLoading");
  });

  // Minor #1 & #4: staying focused past 5 s allows Done ↗ once; malformed hosted URL falls back to srcdoc; rejecting abrirNavegador is caught.
  it("🔴 staying focused past 5 s allows Done ↗ once; malformed hosted URL falls back to srcdoc; rejecting abrirNavegador is handled", async () => {
    let now = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const onPrompt = vi.fn();
    const view = await mount({ onPrompt });
    vi.spyOn(document, "activeElement", "get").mockReturnValue(view.iframe());
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    now += 40_000;
    view.fromFrame({ kind: "ol-visual:prompt", text: "Listo ↗" });
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt).toHaveBeenCalledWith("Listo ↗");

    // Malformed URL from /api/visual-frame-url falls back to srcdoc without throwing.
    const { cliente: badUrlCliente } = makeCliente("not a valid url", true);
    const bad = await mount({}, badUrlCliente);
    expect(bad.iframe().getAttribute("src")).toBeNull();
    expect(bad.iframe().getAttribute("sandbox")).toBe("allow-scripts");

    // Rejecting plataforma.abrirNavegador is caught cleanly (no unhandled rejection).
    m.abrirNavegador.mockRejectedValueOnce(new Error("native browser unavailable"));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      view.fromFrame({ kind: "ol-visual:link", href: "https://example.com/falla" });
      const openBtn = [...view.host.querySelectorAll("button")].find((b) => b.textContent === "visualLinkOpen")!;
      act(() => openBtn.click());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
