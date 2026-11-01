// The PDF pages of the viewer, against pdf.js 6's shape: only the loading task `getDocument()` returns
// has `destroy()`; the document it opens has none (found by opening and closing one in the browser).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const pdf = vi.hoisted(() => {
  const state = { destroy: vi.fn(async () => {}), open: null as null | ((doc: unknown) => void) };
  return state;
});
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: new Promise((resolve) => (pdf.open = resolve)), destroy: pdf.destroy }),
}));

import { MAX_PAGE_PIXELS, PdfPages } from "./pdf-pages";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc = { numPages: 2, getPage: () => new Promise(() => {}) };
const label = (n: number, total: number) => `${n} / ${total}`;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  pdf.destroy.mockClear();
  pdf.open = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => host.remove());

// jsdom's Blob has no arrayBuffer(); the browser's has.
const pdfBlob = () => Object.assign(new Blob(["%PDF-1.7"]), { arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7").buffer });
const settle = () => act(async () => { await vi.waitFor(() => expect(pdf.open).toBeTypeOf("function")); });

describe("PdfPages", () => {
  it("closing the viewer releases the PDF through its loading task, without throwing", async () => {
    await act(async () => root.render(<PdfPages blob={pdfBlob()} pageLabel={label} />));
    await settle();
    await act(async () => pdf.open!(doc));
    expect(host.querySelectorAll("canvas")).toHaveLength(2);
    expect(() => act(() => root.unmount())).not.toThrow();
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });

  describe("drawn at the size it is shown", () => {
    // A page 100×130 at scale 1. jsdom has no canvas, no layout and no observers: the test gives them.
    const render = vi.fn((o: { viewport: { width: number; height: number } }) => ({ promise: Promise.resolve(o), cancel: vi.fn() }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 130 * scale }), render };
    const oneDoc = { numPages: 1, getPage: async () => page };
    let resized: () => void;
    let seen: (visible: boolean) => void;
    let width = 400;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      render.mockClear();
      width = 400;
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
      HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as never;
      globalThis.ResizeObserver = class {
        constructor(cb: () => void) { resized = cb; }
        observe() {}
        disconnect() {}
      } as never;
      globalThis.IntersectionObserver = class {
        constructor(cb: (e: { isIntersecting: boolean }[]) => void) { seen = (v) => cb([{ isIntersecting: v }]); }
        observe() {}
        disconnect() {}
      } as never;
    });
    afterEach(() => {
      vi.useRealTimers();
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    });

    const open = async () => {
      await act(async () => root.render(<PdfPages blob={pdfBlob()} pageLabel={label} />));
      await settle();
      await act(async () => pdf.open!(oneDoc));
      Object.defineProperty(host.querySelector("figure")!, "clientWidth", { configurable: true, get: () => width });
    };
    const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const lastWidth = () => render.mock.calls.at(-1)![0].viewport.width;

    it("a visible page is drawn again, sharp, after zooming in", async () => {
      await open();
      await act(async () => seen(true));
      await flush();
      expect(lastWidth()).toBe(400);
      width = 1000;
      await act(async () => resized());
      await flush();
      expect(render).toHaveBeenCalledTimes(2);
      expect(lastWidth()).toBe(1000);
      expect(host.querySelector("canvas")!.width).toBe(1000);
    });

    it("a small change is not worth a redraw", async () => {
      await open();
      await act(async () => seen(true));
      await flush();
      width = 420;
      await act(async () => resized());
      await flush();
      expect(render).toHaveBeenCalledTimes(1);
    });

    it("a page never takes more than its pixel budget", async () => {
      await open();
      width = 20000;
      await act(async () => seen(true));
      await flush();
      const { width: w, height: h } = render.mock.calls.at(-1)![0].viewport;
      expect(w * h).toBeLessThanOrEqual(MAX_PAGE_PIXELS + 1);
    });

    it("a zoomed page that scrolls away goes back to the screen's width", async () => {
      await open();
      width = 3000;
      await act(async () => seen(true));
      await flush();
      await act(async () => seen(false));
      await flush();
      expect(lastWidth()).toBe(window.innerWidth);
    });

    it("a page never seen is never drawn", async () => {
      await open();
      await act(async () => resized());
      await flush();
      expect(render).not.toHaveBeenCalled();
    });
  });

  it("closed before the PDF opened: released once it opens, without throwing", async () => {
    await act(async () => root.render(<PdfPages blob={pdfBlob()} pageLabel={label} />));
    await settle();
    act(() => root.unmount());
    await act(async () => pdf.open!(doc));
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });
});
