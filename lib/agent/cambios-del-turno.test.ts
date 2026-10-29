// lib/agent/cambios-del-turno.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cambiosEntreFotos, MAX_BYTES_POR_FICHERO } from "./cambios-del-turno";
import { makePointer } from "@/lib/files/blob-pointer";

const ANTES = {
  "/index.html": "<h1>Marejada</h1>\n",
  "/menu/index.html": "<h1>Menú</h1>\n",
  "/datos/reservas.json": "[]\n",
  "/AGENTS.md": "manual\n",
};

describe("cambiosEntreFotos — lo que cambió entre el principio y el final del turno", () => {
  it("sólo lo que cambió, nuevo y borrado incluidos, por ruta", () => {
    const despues = {
      "/index.html": "<h1>Oleaje</h1>\n",
      "/datos/reservas.json": "[]\n",
      "/contacto/index.html": "<h1>Contacto</h1>\n",
      "/AGENTS.md": "manual\n",
    };
    expect(cambiosEntreFotos(ANTES, despues)).toEqual([
      { ruta: "/contacto/index.html", tipo: "texto", antes: null, despues: "<h1>Contacto</h1>\n" },
      { ruta: "/index.html", tipo: "texto", antes: "<h1>Marejada</h1>\n", despues: "<h1>Oleaje</h1>\n" },
      { ruta: "/menu/index.html", tipo: "texto", antes: "<h1>Menú</h1>\n", despues: null },
    ]);
  });

  it("un turno que no tocó nada no trae nada", () => {
    expect(cambiosEntreFotos(ANTES, { ...ANTES })).toEqual([]);
  });

  it("ni el manual ni lo de sólo lectura ni /tmp, aunque aparezcan distintos", () => {
    const despues = {
      ...ANTES,
      "/AGENTS.md": "otro\n",
      "/.openlen/bandeja/formularios.jsonl": "{}\n",
      "/tmp/x": "y",
    };
    expect(cambiosEntreFotos(ANTES, despues)).toEqual([]);
  });

  it("un fichero enorme viaja sin contenido, marcado", () => {
    const grande = "x".repeat(MAX_BYTES_POR_FICHERO + 1);
    expect(cambiosEntreFotos(ANTES, { ...ANTES, "/index.html": grande })).toEqual([
      { ruta: "/index.html", tipo: "grande", nuevo: false, borrado: false },
    ]);
  });
});

describe("a binary in the turn's changes (spec local 2026-10-28-ficheros-al-nivel-de-claude-code)", () => {
  it("🔴 never travels as text (its pointer): «binario» with its bytes before and after", () => {
    const png = makePointer({ sha256: "a".repeat(64), size: 74, gitOid: "b".repeat(40) });
    const otro = makePointer({ sha256: "c".repeat(64), size: 90, gitOid: "d".repeat(40) });
    const c = cambiosEntreFotos({ "/img/b.png": png }, { "/img/a.png": png, "/img/b.png": otro });
    expect(c).toEqual([
      { ruta: "/img/a.png", tipo: "binario", nuevo: true, borrado: false, bytesAntes: 0, bytesDespues: 74 },
      { ruta: "/img/b.png", tipo: "binario", nuevo: false, borrado: false, bytesAntes: 74, bytesDespues: 90 },
    ]);
    expect(JSON.stringify(c)).not.toContain("openlen-blob");
  });
});
