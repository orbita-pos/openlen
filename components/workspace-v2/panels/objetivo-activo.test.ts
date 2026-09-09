// Cancelar el objetivo activo — la puerta del USUARIO.
//
// La maquinaria del objetivo se activaba SÓLO si Len lo proponía y el dueño lo
// aprobaba. El servidor ya sabía cancelarlo desde el principio (`objetivo: null`
// lo borra, `lib/projects/settings-patch.ts`), con el comentario «así lo cancela
// el dueño sin esperar a que se cumpla» — y NINGÚN cliente lo mandaba nunca.
// Medido el 2026-09-08: 0 llamadas en todo el repo.
//
// Se prueba aquí y no montando el panel porque esto decide si al usuario se le
// dice que su objetivo está cancelado, y esa frase tiene que ser VERDAD — la
// misma razón por la que existe `undo-turn.ts`.
import { describe, expect, it, vi } from "vitest";
import { cancelarObjetivo, ponerObjetivo } from "./objetivo-activo";

type Init = { method: string; headers: Record<string, string>; body: string };
const OK = async (_url: string, _init: Init) => ({ ok: true });

describe("cancelarObjetivo", () => {
  it("hace PATCH a los ajustes del proyecto", async () => {
    const fetchImpl = vi.fn(OK);
    await cancelarObjetivo({ projectId: "p1", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/projects/p1/settings");
    expect(init.method).toBe("PATCH");
  });

  // 🔴 EL CUERPO ES `null` LITERAL, Y ES LA TRAMPA DE ESTE FICHERO.
  //
  // El servidor borra con `if ("objetivo" in body)` y luego `=== null`. Un
  // `{ objetivo: undefined }` DESAPARECE al serializar —`JSON.stringify` lo
  // omite— así que llegaría un `{}`, la clave no estaría en el cuerpo, no se
  // borraría nada... y la respuesta seguiría siendo 200. Un no-op que reporta
  // éxito, que es exactamente la clase de avería que este repo ya ha pagado seis
  // veces. Se mira el JSON tal y como viaja, no el objeto antes de serializar.
  it("manda `objetivo: null` LITERAL en el JSON, no una clave ausente", async () => {
    const fetchImpl = vi.fn(OK);
    await cancelarObjetivo({ projectId: "p1", fetchImpl });
    const crudo = fetchImpl.mock.calls[0]![1].body;
    expect(JSON.parse(crudo)).toEqual({ objetivo: null });
    expect(crudo).toContain("null");
  });

  it("200 ⇒ cancelado", async () => {
    expect(await cancelarObjetivo({ projectId: "p1", fetchImpl: vi.fn(OK) })).toEqual({
      ok: true,
    });
  });

  // 🔴 UN 401/404/500 RESUELVE EL `fetch` CON NORMALIDAD: no hay excepción que
  // capturar. Un `try/catch` a secas daría el error por éxito y le diríamos al
  // usuario que su objetivo está cancelado con el objetivo todavía puesto.
  it("un 500 NO es éxito, aunque el fetch resuelva sin lanzar", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: Init) => ({ ok: false }));
    expect(await cancelarObjetivo({ projectId: "p1", fetchImpl })).toEqual({
      ok: false,
      motivo: "servidor",
    });
  });

  it("la red caída tampoco es éxito", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) => Promise.reject(new Error("offline")));
    expect(await cancelarObjetivo({ projectId: "p1", fetchImpl })).toEqual({
      ok: false,
      motivo: "red",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PONER UN OBJETIVO — LA PUERTA DEL DUEÑO.
//
// 🔴 LA VARA: en el binario la puerta del USUARIO es la INVARIANTE. Su esquema
// de ajustes lo dice entero: «'disabled' turns the tool off. A typed /goal is
// unaffected.» O sea, lo que se puede apagar es que el MODELO proponga; lo que
// el dueño teclea no. Nosotros teníamos exactamente lo contrario: una sola vía,
// y era la del modelo — que está medido que no la usa (0 de 11).
//
// No se porta la tecla, se porta la forma: una condición escrita por él, un solo
// gesto, sin llamada de modelo.
// ─────────────────────────────────────────────────────────────────────────────
describe("ponerObjetivo", () => {
  it("hace PATCH con la condición del dueño", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: Init) => ({
      ok: true,
      json: async () => ({ settings: { objetivo: { condicion: "c", creadoEn: "2026-09-09T00:00:00.000Z" } } }),
    }));
    const r = await ponerObjetivo({ projectId: "p1", condicion: "  c  ", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/projects/p1/settings");
    expect(init.method).toBe("PATCH");
    // Se manda RECORTADA: el tope y la tarjeta cuentan caracteres de verdad.
    expect(JSON.parse(init.body)).toEqual({ objetivo: { condicion: "c" } });
    expect(r).toEqual({ ok: true, objetivo: { condicion: "c", creadoEn: "2026-09-09T00:00:00.000Z" } });
  });

  // 🔴 EL `creadoEn` LO PONE EL SERVIDOR y se devuelve el suyo, no un
  // `new Date()` de aquí: el reloj del navegador no es la verdad, y la ficha
  // dice «lo persigue desde…» con esa fecha.
  it("devuelve el objetivo que guardó el SERVIDOR", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: Init) => ({
      ok: true,
      json: async () => ({ settings: { objetivo: { condicion: "recortada", creadoEn: "2020-01-01T00:00:00.000Z" } } }),
    }));
    const r = await ponerObjetivo({ projectId: "p1", condicion: "otra cosa", fetchImpl });
    expect(r.ok && r.objetivo.creadoEn).toBe("2020-01-01T00:00:00.000Z");
    expect(r.ok && r.objetivo.condicion).toBe("recortada");
  });

  it("una condición vacía no se manda siquiera", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: Init) => ({ ok: true, json: async () => ({}) }));
    expect(await ponerObjetivo({ projectId: "p1", condicion: "   ", fetchImpl })).toEqual({
      ok: false,
      motivo: "vacia",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("un 500 no es éxito", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: Init) => ({ ok: false, json: async () => ({}) }));
    expect(await ponerObjetivo({ projectId: "p1", condicion: "c", fetchImpl })).toEqual({
      ok: false,
      motivo: "servidor",
    });
  });

  it("la red caída tampoco", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) => Promise.reject(new Error("offline")));
    expect(await ponerObjetivo({ projectId: "p1", condicion: "c", fetchImpl })).toEqual({
      ok: false,
      motivo: "red",
    });
  });
});
