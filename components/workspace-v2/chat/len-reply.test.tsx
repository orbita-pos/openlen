// LEN'S REPLY WITH ITS VISUALS (local spec 2026-10-16-len-inline-visuals, §4.5).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const mounts = { count: 0 };
vi.mock("./visual-frame", async () => {
  const React = await import("react");
  return {
    VisualFrame: ({ widget, final }: { widget: { code: string }; final: boolean }) => {
      React.useEffect(() => {
        mounts.count++;
      }, []);
      return <div data-testid="visual" data-final={String(final)}>{widget.code}</div>;
    },
  };
});

import { LenReply } from "./len-reply";
import type { DesignTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  mounts.count = 0;
});

function mount(turn: Partial<DesignTurn>, text: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (t: Partial<DesignTurn>, tx: string) =>
    act(() =>
      root.render(
        <LenReply turn={{ id: "t", userText: "x", assistantReasoning: tx, status: "applied", ...t } as DesignTurn} text={tx} streaming={false} paths={[]} />,
      ),
    );
  render(turn, text);
  return { host, render };
}

const widget = { title: "v", loadingMessages: [], code: "<p>V</p>" };

describe("LenReply", () => {
  it("without visuals, Len's text as always", () => {
    const { host } = mount({ actions: [] }, "Hola");
    expect(host.textContent).toBe("Hola");
    expect(host.querySelector('[data-testid="visual"]')).toBeNull();
  });

  it("a stored visual goes where Len put it", () => {
    const { host } = mount({ actions: [{ tool: "show_widget", status: "done", summary: "", widget, textOffset: 5 }] }, "Mira: esto");
    expect(host.textContent).toBe("Mira:<p>V</p> esto");
    expect(host.querySelector('[data-testid="visual"]')!.getAttribute("data-final")).toBe("true");
  });

  it("a visual being written shows live, even with no text yet", () => {
    const { host } = mount({ status: "streaming", liveWidget: { title: null, loadingMessages: [], code: "<p>a", textOffset: 0 } }, "");
    expect(host.querySelector('[data-testid="visual"]')!.getAttribute("data-final")).toBe("false");
  });

  it("when its card arrives, the live visual becomes final in the same frame (no reload)", () => {
    const m = mount({ status: "streaming", actions: [], liveWidget: { title: null, loadingMessages: [], code: "<p>V", textOffset: 5 } }, "Mira:");
    expect(mounts.count).toBe(1);
    m.render({ status: "streaming", actions: [{ tool: "show_widget", status: "done", summary: "", widget, textOffset: 5 }] }, "Mira:");
    expect(mounts.count).toBe(1);
    expect(m.host.querySelector('[data-testid="visual"]')!.getAttribute("data-final")).toBe("true");
  });

  it("a card without a widget (an error) draws nothing", () => {
    const { host } = mount({ actions: [{ tool: "show_widget", status: "error", summary: "" }] }, "No pude.");
    expect(host.querySelector('[data-testid="visual"]')).toBeNull();
  });
});

// GAPS AND LINKS (24/10/2026, from production).
describe("LenReply text", () => {
  it("four line breaks between two notes leave one blank line, and none at the end", () => {
    const { host } = mount({}, "Voy a ver qué hay.\n\n\n\nEl proyecto está vacío.\n\n");
    expect(host.querySelector("p")?.textContent).toBe("Voy a ver qué hay.\n\nEl proyecto está vacío.");
  });

  it("a source cited as [text](url) is a link that opens in a new tab", () => {
    const { host } = mount({}, "Según el [cierre de Investing](https://mx.investing.com/x).");
    const a = host.querySelector("a");
    expect(a?.textContent).toBe("cierre de Investing");
    expect(a?.getAttribute("href")).toBe("https://mx.investing.com/x");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(host.textContent).not.toContain("](");
  });
});
