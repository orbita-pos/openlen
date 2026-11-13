// «YOUR UPLOADS» IN THE IMAGE MODAL (F7, 12/11). What the modal uploads since 28/10 lives in the
// project's folder and is listed by the path the page uses (/img/<name>.webp). The grid painted that
// path as <img src>, which openlen.com answers with a 404. It is painted from the folder's route —
// and what the pick hands back is still the PATH: it is what goes into the page and to Len.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "es" }));

import { ReplaceAssetModal } from "./replace-asset-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ASSETS = [
  { url: "/img/a.webp", filename: "a.webp" },
  { url: "https://cdn.example/b.png", filename: "b.png" },
];

async function openOnUploads(onPick: (payload: { url?: string }) => void): Promise<HTMLElement> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ assets: ASSETS }), { status: 200, headers: { "content-type": "application/json" } })));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(<ReplaceAssetModal open kind="image" projectId="p1" initialTab="uploads" onClose={() => {}} onPick={onPick} />);
  });
  // The list arrives after the first paint.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return document.body;
}

describe("the modal's «your uploads»", () => {
  it("paints a folder file from the folder's route, and a web address as it is", async () => {
    const body = await openOnUploads(() => {});
    const thumbs = ASSETS.map((a) => body.querySelector(`button[aria-label="${a.filename}"] img`)!.getAttribute("src"));
    expect(thumbs).toEqual(["/api/projects/p1/ficheros/raw?ruta=%2Fimg%2Fa.webp", "https://cdn.example/b.png"]);
  });

  it("picking one hands back its PATH, not the address it was painted from", async () => {
    const onPick = vi.fn();
    const body = await openOnUploads(onPick);
    act(() => (body.querySelector('button[aria-label="a.webp"]') as HTMLElement).click());
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ url: "/img/a.webp" }));
  });
});
