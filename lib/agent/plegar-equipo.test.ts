import { describe, expect, it } from "vitest";

import { plegarEquipo } from "./plegar-equipo";
import type { FilaCruda } from "@/lib/projects/chat";

const GENTE = [
  { userId: "u-dana", nombre: "Dana Dueña", rol: "dueno" as const },
  { userId: "u-eli", nombre: "Eli Editor", rol: "editor" as const },
];
const t = (min: number) => new Date(Date.UTC(2026, 9, 7, 18, min));
const turno = (texto: string, min: number, autorId: string | null = null): FilaCruda => ({
  tipo: null,
  autorId,
  menciones: null,
  createdAt: t(min),
  fila: { userText: texto, assistantReasoning: "hecho", transcript: null },
});
const persona = (texto: string, min: number, autorId: string, menciones: string[]): FilaCruda => ({
  tipo: "persona",
  autorId,
  menciones,
  createdAt: t(min),
  fila: { userText: texto, assistantReasoning: "", transcript: null },
});

describe("plegar el chat del equipo en el historial de Len", () => {
  it("🔴 los mensajes entre turnos van delante del turno siguiente, con quién pidió cada turno; los del final, a la petición de ahora", () => {
    const r = plegarEquipo(
      [turno("pon el botón", 1), persona("¿el pie en gris?", 2, "u-eli", ["u-dana"]), turno("pon el pie gris", 3, "u-dana"), persona("y el título", 4, "u-eli", ["u-dana"])],
      GENTE,
      "u-dana",
    );
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0]!.prefijoDelEquipo).toBe('<asked-by name="Dana Dueña" role="owner"/>\n');
    expect(r.filas[1]!.prefijoDelEquipo).toContain('<message from="Eli Editor" role="editor" to="Dana Dueña"');
    expect(r.filas[1]!.prefijoDelEquipo!.endsWith('</team-messages>\n<asked-by name="Dana Dueña" role="owner"/>\n')).toBe(true);
    expect(r.ahora).toContain(">y el título</message>");
  });

  it("🔴 un turno con autorId NULL lo pidió el dueño; ninguna fila de persona queda como turno", () => {
    const r = plegarEquipo([persona("hola", 1, "u-eli", ["u-dana"])], GENTE, "u-dana");
    expect(r.filas).toEqual([]);
    expect(r.ahora).toContain(">hola</message>");
    expect(plegarEquipo([turno("x", 1)], GENTE, "u-dana").filas[0]!.prefijoDelEquipo).toContain('name="Dana Dueña"');
  });
});
