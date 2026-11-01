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

import { PdfPages } from "./pdf-pages";

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

  it("closed before the PDF opened: released once it opens, without throwing", async () => {
    await act(async () => root.render(<PdfPages blob={pdfBlob()} pageLabel={label} />));
    await settle();
    act(() => root.unmount());
    await act(async () => pdf.open!(doc));
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });
});
