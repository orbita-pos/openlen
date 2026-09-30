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
});
