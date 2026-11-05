// OPENLEN'S OWN FILE PICKER FOR A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6): a real
// `<input type="file">` in the workspace, never in the tool's frame — a tool gets only the files the person chose here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import { FilePickDialog } from "./file-pick-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function render(o: { accept?: string; multiple?: boolean } = {}) {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  roots.push(root);
  act(() => root.render(<FilePickDialog open toolTitle="Vídeos" accept={o.accept} multiple={o.multiple ?? false} onPick={onPick} onCancel={onCancel} />));
  return { onPick, onCancel };
}

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
const input = () => document.querySelector<HTMLInputElement>("input[type=file]")!;
function choose(files: File[]) {
  Object.defineProperty(input(), "files", { value: files, configurable: true });
  act(() => input().dispatchEvent(new Event("change", { bubbles: true })));
}

describe("FilePickDialog", () => {
  it("a real file input in the workspace, with what the tool asked to accept", () => {
    render({ accept: "video/*", multiple: true });
    expect(input().accept).toBe("video/*");
    expect(input().multiple).toBe(true);
    expect(document.body.textContent).toContain('tools.files.pick.title {"tool":"Vídeos"}');
  });

  it("nothing to hand over until the person chooses; then exactly what they chose", () => {
    const r = render();
    expect(button("tools.files.pick.use").disabled).toBe(true);
    const file = new File([new Uint8Array(3)], "boda.mp4", { type: "video/mp4" });
    choose([file]);
    expect([...document.querySelectorAll("[data-tool-picked-file]")].map((li) => li.textContent)).toEqual(["boda.mp4"]);
    act(() => button("tools.files.pick.use").click());
    expect(r.onPick).toHaveBeenCalledWith([file]);
  });

  it("one file when the tool asked for one; at most 8 when it asked for several", () => {
    const one = render();
    choose([new File(["a"], "a.txt"), new File(["b"], "b.txt")]);
    act(() => button("tools.files.pick.use").click());
    expect(one.onPick.mock.calls[0]![0]).toHaveLength(1);
    for (const r of roots.splice(0)) act(() => r.unmount());
    document.body.innerHTML = "";
    const many = render({ multiple: true });
    choose(Array.from({ length: 10 }, (_, i) => new File(["x"], `${i}.txt`)));
    act(() => button("tools.files.pick.use").click());
    expect(many.onPick.mock.calls[0]![0]).toHaveLength(8);
  });

  it("«Cancelar» hands over nothing", () => {
    const r = render();
    act(() => button("tools.files.pick.cancel").click());
    expect(r.onCancel).toHaveBeenCalledTimes(1);
    expect(r.onPick).not.toHaveBeenCalled();
  });
});
