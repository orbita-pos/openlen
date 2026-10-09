// @vitest-environment node
// Si el empaquetador no contesta, la app NO se publica (plan 02, Review Focus 3):
// la release anterior sigue, y el error lo dice.
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const raiz = mkdtempSync(path.join(os.tmpdir(), "publicar-sin-empaquetador-"));
process.env.PUBLISH_ROOT = raiz;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";
vi.mock("@/lib/apps/bundler/bundle-app", async (original) => ({
  ...(await original<typeof import("@/lib/apps/bundler/bundle-app")>()),
  bundleApp: async () => null,
}));
const { publishToDir } = await import("@/lib/publish/filesystem");
const { esqueletoDeApp } = await import("@/lib/apps/esqueleto");

describe("publicar una app sin empaquetador (plan 02, tarea 6)", () => {
  it("🔴 lanza con el aviso del empaquetador y no escribe nada", async () => {
    const e = esqueletoDeApp({ titulo: "Caja" });
    await expect(
      publishToDir({
        subdomain: "sin-empaquetador",
        html: e.html,
        files: Object.entries(e.ficheros).map(([p, content]) => ({ path: p, content })),
        app: e.app,
      }),
    ).rejects.toThrow(/bundler didn't answer/);
    expect(existsSync(path.join(raiz, "sin-empaquetador"))).toBe(false);
  }, 30_000);
});
