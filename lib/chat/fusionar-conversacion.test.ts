import { describe, expect, it } from "vitest";

import { fusionarConversacion } from "./fusionar-conversacion";

interface Local {
  readonly id: string;
  readonly status: string;
  readonly texto: string;
  readonly preimagen?: string;
  readonly enServidor?: boolean;
}
interface Fila {
  readonly id: string;
  readonly status: string;
  readonly texto: string;
  readonly enCurso?: boolean;
}

const opciones = (enVuelo: string | null = null) => ({
  enVuelo,
  restaurar: (s: Fila): Local => ({
    id: s.id,
    status: s.enCurso ? "streaming" : s.status,
    texto: s.texto,
    ...(s.enCurso ? { enServidor: true } : {}),
  }),
  conEstado: (l: Local, s: Fila): Local => ({ ...l, status: s.status }),
});

describe("juntar la conversación del servidor con la de la vista", () => {
  it("un turno local conserva su preimagen y toma el estado del servidor (otra pestaña lo deshizo)", () => {
    const r = fusionarConversacion(
      [{ id: "a", status: "applied", texto: "local", preimagen: "<h1>antes</h1>" }],
      [{ id: "a", status: "reverted", texto: "servidor" }],
      opciones(),
    );
    expect(r).toEqual([{ id: "a", status: "reverted", texto: "local", preimagen: "<h1>antes</h1>" }]);
  });

  it("🔴 el turno que esta vista lee por su stream NO se pisa con su fila, aunque la fila ya diga que acabó", () => {
    // La ruta cierra la fila ANTES del `done`; un refresco provocado por otra
    // pestaña puede traerla cerrada mientras aquí aún llegan eventos.
    const enVuelo = { id: "b", status: "streaming", texto: "Voy por la mitad y sigo", preimagen: "<h1>x</h1>" };
    const r = fusionarConversacion([enVuelo], [{ id: "b", status: "applied", texto: "Voy por" }], opciones("b"));
    expect(r).toEqual([enVuelo]);
  });

  it("un turno en curso en el servidor, que aquí no tiene stream, se toma entero de la fila", () => {
    const r = fusionarConversacion(
      [{ id: "c", status: "streaming", texto: "viejo", enServidor: true }],
      [{ id: "c", status: "applied", texto: "Empiezo por el catálogo…", enCurso: true }],
      opciones(),
    );
    expect(r).toEqual([{ id: "c", status: "streaming", texto: "Empiezo por el catálogo…", enServidor: true }]);
  });

  it("y cuando cierra, también: lo seguido desde la fila no tiene nada local que guardar", () => {
    const r = fusionarConversacion(
      [{ id: "c", status: "streaming", texto: "a medias", enServidor: true }],
      [{ id: "c", status: "applied", texto: "Listo: la tienda tiene catálogo." }],
      opciones(),
    );
    expect(r).toEqual([{ id: "c", status: "applied", texto: "Listo: la tienda tiene catálogo." }]);
  });

  it("lo local que el servidor aún no tiene va detrás, en su orden", () => {
    const r = fusionarConversacion(
      [
        { id: "x", status: "streaming", texto: "nuevo 1" },
        { id: "a", status: "applied", texto: "viejo" },
        { id: "y", status: "applied", texto: "nuevo 2" },
      ],
      [{ id: "a", status: "applied", texto: "viejo" }],
      opciones("x"),
    );
    expect(r.map((t) => t.id)).toEqual(["a", "x", "y"]);
  });
  it("🔴 un error que nunca llega al servidor se queda en su sitio, no salta debajo del turno siguiente", () => {
    // «Sin créditos» no deja fila y el cliente no guarda los errores; el turno
    // siguiente sí se guarda. Antes, al converger, el error pasaba al final.
    const r = fusionarConversacion(
      [
        { id: "a", status: "applied", texto: "uno" },
        { id: "err", status: "error", texto: "sin créditos" },
        { id: "b", status: "applied", texto: "dos" },
      ],
      [
        { id: "a", status: "applied", texto: "uno" },
        { id: "b", status: "applied", texto: "dos" },
      ],
      { ...opciones(), keepsPlace: (t: Local) => t.status === "error" },
    );
    expect(r.map((t) => t.id)).toEqual(["a", "err", "b"]);
  });

  it("también el primero de la charla, y un error al final sigue al final", () => {
    const r = fusionarConversacion(
      [
        { id: "err1", status: "error", texto: "falló" },
        { id: "a", status: "applied", texto: "uno" },
        { id: "err2", status: "error", texto: "falló otra vez" },
      ],
      [{ id: "a", status: "applied", texto: "uno" }],
      { ...opciones(), keepsPlace: (t: Local) => t.status === "error" },
    );
    expect(r.map((t) => t.id)).toEqual(["err1", "a", "err2"]);
  });
});
