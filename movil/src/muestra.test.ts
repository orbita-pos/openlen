// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { EventoSse } from "@/lib/len-bench/sse";
import { mandarALen, transcribir } from "./api/chat";
import { leerProyecto } from "./api/proyectos";
import { clienteDeMuestra, RITMO } from "./muestra";

describe("la muestra (sólo dev)", () => {
  it("trae una conversación de varios días con tu foto", async () => {
    const p = await leerProyecto(clienteDeMuestra, "m1");
    expect(p.historial.length).toBeGreaterThanOrEqual(3);
    expect(p.historial.some((t) => t.attachedImage)).toBe(true);
  });

  it("contesta un turno entero que se lee como el de verdad, y lo guarda en la conversación", async () => {
    RITMO.x = 0;
    const eventos: EventoSse[] = [];
    const antes = (await leerProyecto(clienteDeMuestra, "m1")).historial.length;
    const fin = await mandarALen(clienteDeMuestra, { projectId: "m1", prompt: "Pon el horario" }, (e) => eventos.push(e));
    expect(fin).toBe("terminado");
    expect(eventos[0]).toEqual({ nombre: "turno", datos: { turnoId: "muestra-vivo" } });
    expect(eventos.map((e) => e.nombre)).toEqual(expect.arrayContaining(["action", "text", "html", "done"]));
    const despues = (await leerProyecto(clienteDeMuestra, "m1")).historial;
    expect(despues).toHaveLength(antes + 1);
    expect(despues.at(-1)!.userText).toBe("Pon el horario");
  });

  it("transcribe una nota de mentira", async () => {
    RITMO.x = 0;
    expect(await transcribir(clienteDeMuestra, { audio: new Blob(["x"]), projectId: "m1", idioma: "es", segundos: 3 })).toEqual({ texto: "Pon el horario de la tarde, de cinco a ocho." });
  });
});
