// La huella de la carpeta publicable (pieza 9): lo que enciende «cambios sin
// publicar» cuando cambia un `js/app.js` aunque ninguna página se mueva.
import { describe, expect, it } from "vitest";
import { folderFingerprint } from "./files-hash";

describe("la huella de la carpeta publicable", () => {
  it("sin publicables no hay huella (un proyecto sin carpeta no tiene deriva nueva)", () => {
    expect(folderFingerprint({})).toBeNull();
    expect(folderFingerprint({ "/tests/a.spec.ts": "x", "/supabase/migrations/1_a.sql": "y" })).toBeNull();
  });

  it("cambia con el contenido y con la ruta, no con el orden ni con lo que no se publica", () => {
    const a = folderFingerprint({ "/js/a.js": "1", "/css/b.css": "2" });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(folderFingerprint({ "/css/b.css": "2", "/js/a.js": "1" })).toBe(a);
    expect(folderFingerprint({ "/js/a.js": "1", "/css/b.css": "2", "/tests/t.spec.ts": "z" })).toBe(a);
    expect(folderFingerprint({ "/js/a.js": "1!", "/css/b.css": "2" })).not.toBe(a);
    expect(folderFingerprint({ "/js/c.js": "1", "/css/b.css": "2" })).not.toBe(a);
  });

  it("🔴 /.env cuenta: cambia lo que lleva la app publicada aunque no se publique", () => {
    const a = folderFingerprint({ "/js/a.js": "1" });
    expect(folderFingerprint({ "/js/a.js": "1", "/.env": "VITE_A=1" })).not.toBe(a);
    expect(folderFingerprint({ "/.env": "VITE_A=1" })).toMatch(/^[0-9a-f]{16}$/);
  });
});
