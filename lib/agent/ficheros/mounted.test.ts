import { describe, expect, it } from "vitest";

import { ejecutarGlob } from "./glob";
import { ejecutarGrep, type SitioBuscable } from "./grep";
import { mountedSite } from "./mounted";
import { ejecutarRead } from "./read";

// Another project's files under a folder, as Claude Code reads an added working directory (phase 4B).
const P = "/home/user/.assistant/projects/p2";
const HOME = `<!doctype html><html lang="es"><head><title>Canela Tienda</title></head><body><h1>Canela Tienda</h1><a class="btn" href="#comprar">Comprar</a></body></html>`;
const ENVIOS = `<!doctype html><html lang="es"><head><title>Envíos</title></head><body><h1>Envíos</h1></body></html>`;
const files: Record<string, string> = { "/index.html": HOME, "/envios/index.html": ENVIOS };
const site: SitioBuscable = { contenido: (r) => files[r] ?? null, ficheros: Object.keys(files), recientes: ["/envios/index.html"] };
const text = (r: { ok: boolean } & Record<string, unknown>) => JSON.stringify(r);

describe("a project's files mounted under a folder", () => {
  const m = mountedSite(P, site);

  it("lists the mounted files under its folder", () => {
    expect(m.ficheros).toEqual([`${P}/index.html`, `${P}/envios/index.html`]);
  });

  it("opens a file only by its mounted path", () => {
    expect(m.contenido(`${P}/index.html`)).toContain("Canela Tienda");
    expect(m.contenido("/index.html")).toBeNull();
    expect(m.contenido("/home/user/.assistant/projects/p2x/index.html")).toBeNull();
  });

  it("Read, Glob and Grep work on it unchanged, with absolute paths", () => {
    const read = ejecutarRead({ file_path: "~/.assistant/projects/p2/index.html" }, m, new Map());
    expect(read.ok).toBe(true);
    expect(text(read)).toContain("Comprar");
    const glob = text(ejecutarGlob({ pattern: "**/*.html", path: "~/.assistant/projects/p2" }, m));
    expect(glob).toContain(`${P}/index.html`);
    expect(glob).toContain(`${P}/envios/index.html`);
    const grep = text(ejecutarGrep({ pattern: "Comprar", path: "~/.assistant/projects/p2", output_mode: "files_with_matches" }, m));
    expect(grep).toContain(`${P}/index.html`);
  });
});
