// LA FOTO DEL AUTOR EN EXPLORAR, sin «referer». Desde el perfil (2026-10-10) a
// Explorar le llega la foto de Google cuando no hay una subida (`avatarOf`), y
// lh3.googleusercontent.com puede negarla si la petición lleva referer: por eso
// el botón de cuenta ya la pinta con `referrerPolicy="no-referrer"`. Aquí, igual.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "components/community");

describe("la foto del autor en Explorar", () => {
  for (const f of ["explore-card.tsx", "explore-view.tsx"]) {
    it(`🔴 ${f}: cada <img> de avatarUrl va sin referer`, () => {
      const src = readFileSync(join(DIR, f), "utf8");
      const imgs = [...src.matchAll(/<img\b[\s\S]*?\/>/g)].map((m) => m[0]).filter((t) => t.includes("avatarUrl"));
      expect(imgs.length).toBeGreaterThan(0);
      for (const t of imgs) expect(t).toContain('referrerPolicy="no-referrer"');
    });
  }
});
