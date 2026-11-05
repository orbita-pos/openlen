// @vitest-environment node
//
// THE GAME SKELETON IN LEN'S EYES (spec local 2026-11-05-modo-juego-design, §8.3), in a real Chromium: what a
// game is born with starts without an error, and its canvas is drawn by its loop.
import { describe, expect, it } from "vitest";

import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { carpetaDeLaVista, documentoMedible, pantallaDe, type ContextoDeVista } from "@/lib/lienzo/documento";

import { gameSkeleton } from "./skeleton";

describe("the skeleton a game is born with", () => {
  it("🔴 starts in Len's eyes without an error, and its loop draws the canvas", async () => {
    const s = gameSkeleton({ title: "Naves", locale: "es" });
    const v: ContextoDeVista = {
      projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09",
      title: "Naves",
      sub: null,
      pagina: null,
      settings: undefined,
      logoUrl: null,
      files: s.files,
      app: s.app,
      entorno: {},
      pantalla: pantallaDe(undefined),
    };
    const read = `(async () => {
      for (let i = 0; i < 150; i++) {
        const c = document.querySelector("canvas");
        if (c && c.width > 0) {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const px = c.getContext("2d").getImageData(1, 1, 1, 1).data;
          return { width: c.clientWidth, height: c.clientHeight, alpha: px[3] };
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      return null;
    })()`;
    const m = await renderVisualQualityViewports(documentoMedible(s.html, v), {}, { behaviorProgram: read, carpeta: (await carpetaDeLaVista(v))! });
    expect(m).not.toBeNull();
    expect(m!.runtimeErrors ?? []).toEqual([]);
    const r = m!.behaviorResult as { width: number; height: number; alpha: number } | null;
    expect(r).not.toBeNull();
    expect(r!.width).toBeGreaterThan(0);
    expect(r!.height).toBeGreaterThan(0);
    expect(r!.alpha).toBe(255);
  }, 90_000);
});
