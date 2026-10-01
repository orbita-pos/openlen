// @vitest-environment node
// Los 10 idiomas de la app tienen las MISMAS claves que el español: una que
// falte sale en la pantalla como su nombre («movil.chat.leido»).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IDIOMAS } from "./config";

const claves = (o: unknown, p = ""): string[] =>
  typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => claves(v, p ? `${p}.${k}` : k)) : [p];
const leer = (i: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", i, "movil.json"), "utf8")) as unknown;

describe("los textos de la app", () => {
  const es = claves(leer("es")).sort();
  for (const i of IDIOMAS) {
    it(`${i} tiene las mismas claves que es`, () => {
      expect(claves(leer(i)).sort()).toEqual(es);
    });
  }
  it("el chat tiene sus textos", () => {
    expect(es).toContain("chat.pedirCambio");
    expect(es).toContain("chat.avance.trabajando");
  });
});
