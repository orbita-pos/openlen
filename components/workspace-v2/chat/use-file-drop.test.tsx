// Dropping files on the chat (spec local 2026-10-27-chat-drop-and-images, Part A): the overlay is
// up only while FILES are dragged over, survives the enter/leave of the children under the
// pointer, and a drag of text or of something inside the page is none of its business.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { useFileDrop } from "./use-file-drop";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(o: { enabled: boolean; onFiles: (f: File[]) => void }) {
  let dragging = false;
  const portalHost = document.createElement("div");
  document.body.appendChild(portalHost);
  function Zone() {
    const d = useFileDrop(o);
    dragging = d.dragging;
    return (
      <div data-zone="" {...d.handlers}>
        <span data-child="" />
        {createPortal(<div data-portaled="" />, portalHost)}
      </div>
    );
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Zone />));
  return {
    zone: host.querySelector("[data-zone]")!,
    child: host.querySelector("[data-child]")!,
    portaled: portalHost.querySelector("[data-portaled]")!,
    dragging: () => dragging,
  };
}

function drag(target: Element, type: string, types: string[], files: File[] = []) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
  e.dataTransfer = { types, files, dropEffect: "none" };
  act(() => void target.dispatchEvent(e));
  return e;
}

const png = new File([new Uint8Array(1)], "a.png", { type: "image/png" });

describe("useFileDrop", () => {
  it("shows while files are dragged over and hides on leave, through the children", () => {
    const z = mount({ enabled: true, onFiles: () => {} });
    drag(z.zone, "dragenter", ["Files"]);
    expect(z.dragging()).toBe(true);
    drag(z.child, "dragenter", ["Files"]);
    drag(z.zone, "dragleave", ["Files"]);
    expect(z.dragging()).toBe(true);
    drag(z.child, "dragleave", ["Files"]);
    expect(z.dragging()).toBe(false);
  });

  it("ignores drags without files", () => {
    const onFiles = vi.fn();
    const z = mount({ enabled: true, onFiles });
    drag(z.zone, "dragenter", ["text/plain"]);
    expect(z.dragging()).toBe(false);
    expect(drag(z.zone, "dragover", ["text/plain"]).defaultPrevented).toBe(false);
    const drop = drag(z.zone, "drop", ["text/plain"]);
    expect(onFiles).not.toHaveBeenCalled();
    expect(drop.defaultPrevented).toBe(false);
  });

  it("drop hands over the files and hides", () => {
    const onFiles = vi.fn();
    const z = mount({ enabled: true, onFiles });
    drag(z.zone, "dragenter", ["Files"]);
    expect(drag(z.zone, "dragover", ["Files"]).defaultPrevented).toBe(true);
    const drop = drag(z.zone, "drop", ["Files"], [png]);
    expect(drop.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([png]);
    expect(z.dragging()).toBe(false);
  });

  it("disabled: nothing", () => {
    const onFiles = vi.fn();
    const z = mount({ enabled: false, onFiles });
    drag(z.zone, "dragenter", ["Files"]);
    drag(z.zone, "drop", ["Files"], [png]);
    expect(z.dragging()).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  // Review of the branch: a dialog portaled from the chat (the image picker) has its own drop zone.
  it("a drop inside a portaled dialog, or one a child already handled, is not the chat's", () => {
    const onFiles = vi.fn();
    const z = mount({ enabled: true, onFiles });
    drag(z.portaled, "dragenter", ["Files"]);
    expect(z.dragging()).toBe(false);
    drag(z.portaled, "drop", ["Files"], [png]);
    const handled = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    handled.dataTransfer = { types: ["Files"], files: [png], dropEffect: "none" };
    handled.preventDefault();
    act(() => void z.child.dispatchEvent(handled));
    expect(onFiles).not.toHaveBeenCalled();
  });

  // Review of the branch: Chromium lists "Files" when an <img> of the page itself is dragged.
  it("a drag that started in the page (a thumbnail, a photo in a reply) is ignored", () => {
    const onFiles = vi.fn();
    const z = mount({ enabled: true, onFiles });
    act(() => void z.child.dispatchEvent(new Event("dragstart", { bubbles: true })));
    drag(z.zone, "dragenter", ["Files"]);
    expect(z.dragging()).toBe(false);
    drag(z.zone, "drop", ["Files"], [png]);
    expect(onFiles).not.toHaveBeenCalled();
    act(() => void z.child.dispatchEvent(new Event("dragend", { bubbles: true })));
    drag(z.zone, "dragenter", ["Files"]);
    expect(z.dragging()).toBe(true);
  });
});
