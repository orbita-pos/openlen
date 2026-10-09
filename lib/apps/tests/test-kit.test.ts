// @vitest-environment node
// El kit de pruebas (plan 04): congelado, con React FUERA, y el mismo React
// que los catálogos a los que sirve.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGOS, catalogo } from "@/lib/apps/dependencias";
import { TEST_KIT, TEST_KIT_NAME, testKitFor } from "./test-kit";

const DIR = path.join(process.cwd(), "public", "app-vendor", TEST_KIT_NAME);
const ficheros = [...new Set([...TEST_KIT.dependencias.map((d) => d.fichero), ...TEST_KIT.internos])];

describe("el kit de pruebas", () => {
  it("🔴 está construido: cada fichero, con la huella de su manifiesto", () => {
    const m = JSON.parse(readFileSync(path.join(DIR, "manifest.json"), "utf8")) as { ficheros: { desarrollo: Record<string, string> } };
    expect(Object.keys(m.ficheros.desarrollo).sort()).toEqual([...ficheros].sort());
    for (const f of ficheros) expect(existsSync(path.join(DIR, "desarrollo", f)), f).toBe(true);
  });

  it("🔴 NO lleva React: lo pide por su nombre, y lo pone el catálogo de la app", () => {
    for (const f of ficheros) {
      const js = readFileSync(path.join(DIR, "desarrollo", f), "utf8");
      expect(js, f).not.toContain("__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE");
    }
    const rtl = readFileSync(path.join(DIR, "desarrollo", "testing-library-react.js"), "utf8");
    expect(rtl).toMatch(/from\s*"react"/);
    expect(rtl).not.toMatch(/from\s*"react-dom\/test-utils"/);
  });

  it("sirve a cada catálogo que tiene SU React (una copia, o los hooks se rompen)", () => {
    for (const nombre of Object.keys(CATALOGOS)) {
      expect(testKitFor(nombre)).toBe(TEST_KIT_NAME);
      expect(catalogo(nombre)!.versiones.react).toBe(TEST_KIT.versiones.react);
    }
  });
});
