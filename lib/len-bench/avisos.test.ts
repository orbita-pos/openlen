// lib/len-bench/avisos.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { avisosDelEncargo } from "./avisos";
import { cargarEncargos } from "./casos/cargar";
import { lenPublico } from "./graders";
import type { Encargo } from "./tipos";

const base: Encargo = {
  id: "x",
  nivel: "N2",
  resumen: "",
  inicio: { html: "<p>hola</p>" },
  ficha: { negocio: "Fotógrafos", datos: {} },
  guion: [{ tipo: "pide", mensaje: "cámbialo y publícala" }],
  graders: [lenPublico()],
  solucion: { html: "<p>hola</p>" },
  rotas: [],
  publicaLen: true,
};

describe("avisosDelEncargo — lo que no puede pasar con lo que la corrida permite", () => {
  it("publicar sin dirección en la ficha: Len la pide, el dueño no la tiene, nadie publica", () => {
    // Calibración del 2026-09-24, `cambialo-y-publicalo`: 0 de 3 por esto.
    expect(avisosDelEncargo(base)).toEqual([
      "«len-publico» no puede pasar: publicar pide al dueño la dirección y su ficha no la trae (datos.subdominio)",
    ]);
  });
  it("con la dirección en la ficha, se puede", () => {
    expect(avisosDelEncargo({ ...base, ficha: { ...base.ficha, datos: { subdominio: "robleyluz" } } })).toEqual([]);
  });
  it("un len-publico que vota sin la concesión: nadie tocaría la tarjeta", () => {
    expect(avisosDelEncargo({ ...base, publicaLen: undefined, ficha: { ...base.ficha, datos: { subdominio: "robleyluz" } } })).toEqual([
      "«len-publico» no puede pasar: el encargo no concede publicar (publicaLen), así que nadie toca la tarjeta «Publicar»",
    ]);
  });
  it("ningún caso de dev tiene un grader que no pueda pasar", async () => {
    for (const e of await cargarEncargos("dev")) expect(avisosDelEncargo(e), e.id).toEqual([]);
  }, 30_000);
});
