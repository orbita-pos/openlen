import { describe, expect, it } from "vitest";

import { partirGritos } from "./rotura-ajena";
import { objectiveBreakage, roturaDeRed } from "./objective-breakage";

// LOS TRES GRITOS REALES del 2026-09-04, copiados del navegador tal cual.
// Es el caso que motivó el módulo: cuatro páginas reescritas seguidas, ninguna
// entregada, por una cabecera HTTP que faltaba en nuestro propio origen.
const CORS =
  "Access to script at 'https://libs.openlen.com/chart.js/4.5.0/chart.umd.min.js' from origin 'http://127.0.0.1:44841' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.";
const RECURSO = "Failed to load resource: net::ERR_FAILED";
const COLATERAL = "Chart is not defined";

describe("partirGritos", () => {
  it("sin gritos no parte nada", () => {
    expect(partirGritos([])).toEqual({ propios: [], ajenos: [] });
    expect(partirGritos(undefined)).toEqual({ propios: [], ajenos: [] });
    expect(partirGritos(null)).toEqual({ propios: [], ajenos: [] });
  });

  it("el caso real: los tres son AJENOS, ninguno es del modelo", () => {
    const r = partirGritos([CORS, RECURSO, COLATERAL]);
    expect(r.propios).toEqual([]);
    expect(r.ajenos).toHaveLength(3);
  });

  it("un fallo de verdad del modelo sigue siendo suyo", () => {
    const suyo = "Assignment to constant variable.";
    const r = partirGritos([suyo]);
    expect(r.propios).toEqual([suyo]);
    expect(r.ajenos).toEqual([]);
  });

  it("mezcla: se queda con lo que el modelo puede arreglar", () => {
    const suyo = "Cannot read properties of null (reading 'addEventListener')";
    const r = partirGritos([CORS, COLATERAL, suyo]);
    expect(r.propios).toEqual([suyo]);
    expect(r.ajenos).toEqual([CORS, COLATERAL]);
  });

  it("SIN fallo de carga, un `no está definido` es del modelo aunque nombre una librería", () => {
    // Es la mitad que impide que esto tape un typo: si nada se cayó, que
    // `Chart` no exista es que el modelo no puso la etiqueta.
    const r = partirGritos([COLATERAL]);
    expect(r.propios).toEqual([COLATERAL]);
    expect(r.ajenos).toEqual([]);
  });

  it("y con fallo de carga, un nombre que NO es de librería sigue siendo del modelo", () => {
    // La otra mitad: una imagen que no baja no puede amnistiar los typos.
    const typo = "precioTotal is not defined";
    const r = partirGritos([RECURSO, typo]);
    expect(r.propios).toEqual([typo]);
    expect(r.ajenos).toEqual([RECURSO]);
  });

  it("`chartData` no se confunde con `Chart`", () => {
    const typo = "chartData is not defined";
    expect(partirGritos([CORS, typo]).propios).toEqual([typo]);
  });

  it("cubre los globales del catálogo, el del núcleo de PhotoSwipe incluido", () => {
    for (const nombre of ["Swiper", "PhotoSwipeLightbox", "PhotoSwipe"]) {
      const grito = `${nombre} is not defined`;
      expect(partirGritos([RECURSO, grito]).ajenos).toContain(grito);
    }
  });

  it("reconoce las otras formas del mismo fallo de carga", () => {
    for (const grito of [
      "Failed to load resource: the server responded with a status of 404",
      "Loading failed for the <script> with source “https://libs.openlen.com/swiper/12.2.0/swiper-bundle.min.js”.",
      "Failed to find a valid digest in the 'integrity' attribute for resource",
      "GET https://libs.openlen.com/x.js net::ERR_CONNECTION_REFUSED",
    ]) {
      expect(partirGritos([grito]).ajenos).toEqual([grito]);
    }
  });

  it("un script que HABLA de un fallo de carga no se calla — el corte es al principio", () => {
    // La invariante que `lib/ai/inline-image.test.ts` ya sujetaba y que este
    // módulo heredó: sin el ancla, el filtro sería un silenciador.
    for (const habla of [
      "mi script dice: failed to load resource",
      "Uncaught Error: la imagen ha sido blocked by CORS policy, avisa al dueño",
    ]) {
      expect(partirGritos([habla]).propios).toEqual([habla]);
    }
  });

  it("una negativa de la CSP SÍ es del modelo — usó un CDN que no sobrevive", () => {
    const csp =
      "Refused to load the script 'https://cdn.jsdelivr.net/npm/chart.js' because it violates the following Content Security Policy directive";
    expect(partirGritos([csp]).propios).toEqual([csp]);
  });
});

describe("la puerta de generación no cobra lo ajeno", () => {
  it("objectiveBreakage ignora la rotura de red y roturaDeRed la recoge", () => {
    const medido = { runtimeErrors: [CORS, RECURSO, COLATERAL] };
    // Sin esto, estas tres líneas disparaban una reparación y luego una
    // reescritura ENTERA de la página del usuario.
    expect(objectiveBreakage(medido)).toEqual([]);
    expect(roturaDeRed(medido)).toHaveLength(3);
  });

  it("pero un fallo del modelo sigue siendo motivo para regenerar", () => {
    const medido = { runtimeErrors: [CORS, "Assignment to constant variable."] };
    expect(objectiveBreakage(medido)).toHaveLength(1);
    expect(objectiveBreakage(medido)[0]).toContain("Assignment to constant variable.");
    expect(roturaDeRed(medido)).toEqual([CORS]);
  });

  it("y las otras roturas medidas no se tocan", () => {
    const medido = { mobileOverflow: true, runtimeErrors: [CORS] };
    expect(objectiveBreakage(medido)).toHaveLength(1);
    expect(objectiveBreakage(medido)[0]).toContain("se desborda");
  });

  it("el tope de tres se aplica a los PROPIOS, no a la lista cruda", () => {
    // Antes, tres gritos de red se comían el cupo entero y el defecto real del
    // modelo —el cuarto— no llegaba nunca al reparador.
    const medido = {
      runtimeErrors: [CORS, RECURSO, COLATERAL, "Assignment to constant variable."],
    };
    expect(objectiveBreakage(medido)).toHaveLength(1);
  });
});
