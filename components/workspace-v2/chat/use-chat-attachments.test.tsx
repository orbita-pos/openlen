// The chat's uploads in flight (spec local 2026-10-27-chat-drop-and-images, Part A): each accepted
// file is a pending chip until it lands, the limits count what is still on its way, a cancelled
// upload never comes back, and what is left out is said once, by name.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useChatAttachments } from "./use-chat-attachments";
import type { AttachedImage } from "./use-agent-chat";
import type { AttachedFile } from "@/lib/projects/chat-files";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

const photo = (name: string) => new File([new Uint8Array(1)], name, { type: "image/png" });
const pdf = (name: string) => new File([new Uint8Array(1)], name, { type: "application/pdf" });

const MESSAGES = {
  notSupported: (names: string) => `not supported: ${names}`,
  tooBig: (names: string) => `too big: ${names}`,
  limit: (count: number) => `left out: ${count}`,
  failed: (name: string) => `failed: ${name}`,
};

/** A deferred upload the test resolves by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

type Hook = ReturnType<typeof useChatAttachments> & { images: readonly AttachedImage[]; files: readonly AttachedFile[] };

async function mount(o: { images?: AttachedImage[]; photo?: (f: File) => Promise<unknown>; file?: (f: File) => Promise<unknown> }) {
  const notify = vi.fn();
  let hook: Hook | null = null;
  function Chat() {
    const [images, setImages] = useState<readonly AttachedImage[]>(o.images ?? []);
    const [files, setFiles] = useState<readonly AttachedFile[]>([]);
    const a = useChatAttachments({
      projectId: "p1",
      images,
      setImages,
      files,
      setFiles,
      notify,
      messages: MESSAGES,
      upload: {
        ...(o.photo ? { photo: o.photo as never } : {}),
        ...(o.file ? { file: o.file as never } : {}),
      },
    });
    hook = { ...a, images, files };
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Chat />));
  return { get: () => hook!, notify };
}

describe("useChatAttachments", () => {
  it("each accepted file is pending until its upload ends, then attached", async () => {
    const up = deferred<unknown>();
    const upPdf = deferred<unknown>();
    const h = await mount({ photo: () => up.promise, file: () => upPdf.promise });
    await act(async () => h.get().addFiles([photo("a.png"), pdf("menu.pdf")]));
    expect(h.get().pending.map((p) => [p.name, p.kind])).toEqual([
      ["a.png", "photo"],
      ["menu.pdf", "file"],
    ]);
    await act(async () => up.resolve({ ok: true, image: { url: "https://u/a.png" } }));
    await act(async () => upPdf.resolve({ ok: true, file: { url: "/uploads/p1/m.pdf", name: "menu.pdf", size: 1 } }));
    expect(h.get().pending).toEqual([]);
    expect(h.get().images).toEqual([{ url: "https://u/a.png" }]);
    expect(h.get().files).toEqual([{ url: "/uploads/p1/m.pdf", name: "menu.pdf", size: 1 }]);
  });

  it("room counts pending uploads too", async () => {
    const h = await mount({ images: [{ url: "1" }, { url: "2" }, { url: "3" }], photo: () => new Promise(() => {}) });
    await act(async () => h.get().addFiles([photo("x.png")]));
    expect(h.get().pending).toHaveLength(1);
    await act(async () => h.get().addFiles([photo("y.png"), photo("z.png")]));
    expect(h.get().pending).toHaveLength(1);
    expect(h.notify).toHaveBeenCalledWith("left out: 2");
  });

  it("a cancelled upload never attaches", async () => {
    const up = deferred<unknown>();
    const h = await mount({ photo: () => up.promise });
    await act(async () => h.get().addFiles([photo("a.png")]));
    await act(async () => h.get().cancel(h.get().pending[0]!.id));
    expect(h.get().pending).toEqual([]);
    await act(async () => up.resolve({ ok: true, image: { url: "https://u/a.png" } }));
    expect(h.get().images).toEqual([]);
  });

  it("a failed upload is dropped with a toast naming the file", async () => {
    const h = await mount({ file: async () => ({ ok: false, reason: "failed" }) });
    await act(async () => h.get().addFiles([pdf("menu.pdf")]));
    expect(h.get().pending).toEqual([]);
    expect(h.get().files).toEqual([]);
    expect(h.notify).toHaveBeenCalledWith("failed: menu.pdf");
  });

  it("rejected files are named in one toast per reason", async () => {
    const h = await mount({});
    await act(async () => h.get().addFiles([new File([new Uint8Array(1)], "x.zip", { type: "application/zip" }), new File([new Uint8Array(1)], "y.exe", { type: "" })]));
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith("not supported: x.zip, y.exe");
  });
});
