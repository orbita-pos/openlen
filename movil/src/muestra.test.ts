// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { EventoSse } from "@/lib/len-bench/sse";
import { dirigirA, mandarALen, transcribir } from "./api/chat";
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

  it("como el servidor: la fila lleva el id que mandó la app, y lo que corriges a media faena va en tu mensaje con «↳»", async () => {
    RITMO.x = 0;
    let empezo: (id: string) => void = () => {};
    const turnoId = new Promise<string>((r) => (empezo = r));
    const turno = mandarALen(clienteDeMuestra, { projectId: "m1", prompt: "1", turnId: "f-muestra" }, (e) => {
      if (e.nombre === "turno") empezo(String((e.datos as { turnoId: string }).turnoId));
    });
    await dirigirA(clienteDeMuestra, await turnoId, "1");
    await turno;
    const fila = (await leerProyecto(clienteDeMuestra, "m1")).historial.at(-1)!;
    expect(fila).toMatchObject({ id: "f-muestra", userText: "1\n↳ 1" });
  });

  it("transcribe una nota de mentira", async () => {
    RITMO.x = 0;
    expect(await transcribir(clienteDeMuestra, { audio: new Blob(["x"]), projectId: "m1", idioma: "es", segundos: 3 })).toEqual({ texto: "Pon el horario de la tarde, de cinco a ocho." });
  });
});
