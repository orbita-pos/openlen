// A TOOL'S ICON IN OPENLEN'S CHROME (spec local 2026-11-04-herramientas-hechas-por-len, §4.3): an SVG drawn in
// currentColor would be black inside an <img> — invisible on the dark rail. It is painted as a mask in the colour
// around it instead; a raster icon is shown as it is.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ToolIcon } from "./tool-icon";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function render(node: React.ReactNode) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root!.render(node));
}

describe("ToolIcon", () => {
  it("an SVG: a mask in the colour around it, never an <img>", () => {
    render(<ToolIcon url="/api/tools/a/icon?v=1" tinted size={16} />);
    expect(document.querySelector("img")).toBeNull();
    const el = document.querySelector<HTMLElement>("[data-tool-icon]")!;
    expect(el.style.backgroundColor).toBe("currentcolor");
    // jsdom drops the mask declarations; the icon it masks with travels on the element.
    expect(el.getAttribute("data-tool-icon")).toBe("/api/tools/a/icon?v=1");
    expect(el.style.width).toBe("16px");
  });

  it("a raster icon: the image as it is", () => {
    render(<ToolIcon url="/api/tools/a/icon?v=1" tinted={false} size={28} />);
    const img = document.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/tools/a/icon?v=1");
    expect(img.getAttribute("width")).toBe("28");
  });
});
