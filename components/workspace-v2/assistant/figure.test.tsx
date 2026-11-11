// HER FIGURE IN REACT (spec local 2026-11-10-figuras-del-asistente, §5.3): flat from the catalog; alive only when the
// switch says so and the engine can draw, and flat again whenever it can't.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DEFAULT_LOOK } from "@/lib/figure/look";

import { AssistantFigure } from "./figure";
import { LiveFigure, figuresOn, forgetFiguresAnswer } from "./live-figure";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  forgetFiguresAnswer();
});
async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  return host;
}

describe("AssistantFigure", () => {
  it("draws her look from the catalog, one layer per part", async () => {
    const host = await mount(<AssistantFigure look={{ ...DEFAULT_LOOK, shape: "heart", accessory: "crown", eyewear: "round" }} size={40} />);
    expect(host.querySelector('svg[width="40"] [data-part="body"]')).not.toBeNull();
    expect(host.querySelector('[data-part="accessory"]')).not.toBeNull();
    expect(host.querySelector('[data-part="eyewear"]')).not.toBeNull();
    expect(host.querySelector("[data-assistant-figure]")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("has a name only when it is given one", async () => {
    const host = await mount(<AssistantFigure look={DEFAULT_LOOK} label="Lucía" />);
    const figure = host.querySelector("[data-assistant-figure]")!;
    expect(figure.getAttribute("role")).toBe("img");
    expect(figure.getAttribute("aria-label")).toBe("Lucía");
    expect(figure.hasAttribute("aria-hidden")).toBe(false);
  });
});

describe("LiveFigure", () => {
  it("🔴 with the switch off it stays flat and never asks for a WebGL context", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const host = await mount(<LiveFigure look={DEFAULT_LOOK} size={96} ask={async () => false} />);
    expect(host.querySelector("[data-figure]")!.getAttribute("data-figure")).toBe("flat");
    expect(host.querySelector('[data-part="body"]')).not.toBeNull();
    expect(getContext).not.toHaveBeenCalled();
    getContext.mockRestore();
  });

  it("🔴 where the engine cannot draw (no WebGL2) it stays flat and nothing throws", async () => {
    const host = await mount(<LiveFigure look={DEFAULT_LOOK} size={96} ask={async () => true} />);
    expect(host.querySelector("[data-figure]")!.getAttribute("data-figure")).toBe("flat");
    expect(host.querySelector('[data-part="body"]')).not.toBeNull();
  });

  it("asks the switch once per page, and not knowing is off", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ enabled: true })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await figuresOn()).toBe(true);
    expect(await figuresOn()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    forgetFiguresAnswer();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await figuresOn()).toBe(false);
  });
});
