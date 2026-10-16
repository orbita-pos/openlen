// LEN'S VISUALS IN THE CHAT (local spec 2026-10-16-len-inline-visuals): the
// frame the chat puts a visual in, and what it does with the frame's messages.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));
const frameUrl = { value: "https://lienzo-visuals.openlen.app/" as string | null | undefined };
vi.mock("@/lib/visuals/use-visual-frame-url", () => ({ useVisualFrameUrl: () => frameUrl.value }));

import { VisualFrame } from "./visual-frame";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FRAME_ORIGIN = "https://lienzo-visuals.openlen.app";
const widget = { title: "visits_week", loadingMessages: ["Contando visitas"], code: "<p>hola</p>" };
const roots: Root[] = [];

beforeEach(() => {
  frameUrl.value = `${FRAME_ORIGIN}/`;
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
});

function mount(props: Partial<Parameters<typeof VisualFrame>[0]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (p: Partial<Parameters<typeof VisualFrame>[0]>) =>
    act(() => root.render(<VisualFrame widget={widget} final {...props} {...p} />));
  render({});
  const iframe = () => host.querySelector("iframe")!;
  const posted: unknown[] = [];
  const spy = () => vi.spyOn(iframe().contentWindow!, "postMessage").mockImplementation((m: unknown) => void posted.push(m));
  const fromFrame = (data: unknown, origin = FRAME_ORIGIN) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source: iframe().contentWindow }));
    });
  return { host, iframe, posted, spy, fromFrame, render };
}

describe("VisualFrame", () => {
  it("with the isolated host, an iframe from it that may keep its own origin", () => {
    const { iframe } = mount();
    expect(iframe().getAttribute("src")).toBe(`${FRAME_ORIGIN}/`);
    expect(iframe().getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(iframe().getAttribute("title")).toBe('visualLabel {"title":"visits_week"}');
  });

  it("without it, a srcdoc frame with its policy in a meta tag and no allow-same-origin", () => {
    frameUrl.value = null;
    const { iframe } = mount();
    expect(iframe().getAttribute("src")).toBeNull();
    expect(iframe().getAttribute("srcdoc")).toContain('http-equiv="Content-Security-Policy"');
    expect(iframe().getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("when the frame is ready, it gets the theme and the code; the next chunk is another render", () => {
    const m = mount({ final: false });
    m.spy();
    m.fromFrame({ kind: "ol-visual:ready" });
    expect(m.posted[0]).toMatchObject({ kind: "ol-visual:theme", theme: "light" });
    expect(m.posted[1]).toEqual({ kind: "ol-visual:render", code: "<p>hola</p>", final: false });
    m.render({ widget: { ...widget, code: "<p>hola mundo</p>" }, final: false });
    expect(m.posted.at(-1)).toEqual({ kind: "ol-visual:render", code: "<p>hola mundo</p>", final: false });
  });

  it("switching the workspace to dark sends a new theme", async () => {
    const m = mount();
    m.spy();
    m.fromFrame({ kind: "ol-visual:ready" });
    await act(async () => {
      document.documentElement.classList.add("dark");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(m.posted.at(-1)).toMatchObject({ kind: "ol-visual:theme", theme: "dark" });
  });

  it("takes the frame's height, up to 2000px", () => {
    const m = mount();
    m.fromFrame({ kind: "ol-visual:height", height: 240 });
    expect(m.iframe().style.height).toBe("240px");
    m.fromFrame({ kind: "ol-visual:height", height: 99_999 });
    expect(m.iframe().style.height).toBe("2000px");
  });

  it("a prompt without a recent click into the frame is ignored; after one, it is sent once", () => {
    const onPrompt = vi.fn();
    const m = mount({ onPrompt });
    m.fromFrame({ kind: "ol-visual:prompt", text: "¿y en marzo?" });
    expect(onPrompt).not.toHaveBeenCalled();
    vi.spyOn(document, "activeElement", "get").mockReturnValue(m.iframe());
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    m.fromFrame({ kind: "ol-visual:prompt", text: "¿y en marzo?" });
    m.fromFrame({ kind: "ol-visual:prompt", text: "otra vez" });
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt).toHaveBeenCalledWith("¿y en marzo?");
  });

  it("a link asks first, then opens in a new tab; only http(s)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const m = mount();
    m.fromFrame({ kind: "ol-visual:link", href: "javascript:alert(1)" });
    expect(m.host.textContent).not.toContain("visualLinkTitle");
    m.fromFrame({ kind: "ol-visual:link", href: "https://example.com/x" });
    expect(m.host.textContent).toContain("visualLinkTitle");
    expect(m.host.textContent).toContain("https://example.com/x");
    const openButton = [...m.host.querySelectorAll("button")].find((b) => b.textContent === "visualLinkOpen")!;
    act(() => openButton.click());
    expect(open).toHaveBeenCalledWith("https://example.com/x", "_blank", "noopener,noreferrer");
    expect(m.host.textContent).not.toContain("visualLinkTitle");
  });

  it("ignores messages from anything but its own frame", () => {
    const m = mount();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { kind: "ol-visual:height", height: 300 }, origin: FRAME_ORIGIN, source: window }));
    });
    expect(m.iframe().style.height).not.toBe("300px");
    m.fromFrame({ kind: "ol-visual:height", height: 310 }, "https://evil.example");
    expect(m.iframe().style.height).not.toBe("310px");
  });

  it("while it is being written, the loading message shows", () => {
    expect(mount({ final: false }).host.textContent).toContain("Contando visitas");
    expect(mount({ final: false, widget: { ...widget, loadingMessages: [] } }).host.textContent).toContain("visualLoading");
  });
});
