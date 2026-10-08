// lib/len-bench/casos/dev/pagina-que-se-vuelve-app.test.ts — el caso de la
// conversión, a $0: la partida es una página de tres páginas, la solución una
// app que compila, y cada rota de app compila salvo la que no debe.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { problemasDeLaApp } from "@/lib/len-bench/app-verificada";
import { avisaDeLoQueSePierde, seConvirtioEnApp } from "@/lib/len-bench/conversion";
import type { ContextoDeCalificacion, DatosDelCaso } from "@/lib/len-bench/tipos";
import { crear } from "./pagina-que-se-vuelve-app";

const caso = crear();
const problemas = (d: DatosDelCaso) => problemasDeLaApp(d, d.ficheros ?? {});
const rota = (n: string) => caso.rotas.find((r) => r.nombre === n)!.datos;

describe("pagina-que-se-vuelve-app — tres páginas que pasan a ser una app", () => {
  it("parte de una PÁGINA de tres páginas, sin app", () => {
    expect(caso.inicio.app).toBeUndefined();
    expect(Object.keys(caso.inicio.pages ?? {})).toEqual(["carta", "contacto"]);
    expect(caso.naceComo).toBeUndefined();
  });

  it("🔴 la solución es una app sin páginas que pasa su verificación", () => {
    expect(caso.solucion.app).toBeDefined();
    expect(caso.solucion.pages).toBeUndefined();
    expect(problemas(caso.solucion)).toEqual([]);
  });

  it("las rotas de app compilan salvo `no-compila`; la que sigue siendo página no es una app", () => {
    expect(problemas(rota("sigue-siendo-pagina"))).toBeNull();
    expect(problemas(rota("no-compila"))!.join("\n")).toMatch(/\/src\/screens\/Carta\.jsx/);
    for (const r of caso.rotas.filter((x) => !["sigue-siendo-pagina", "no-compila"].includes(x.nombre))) {
      expect(problemas(r.datos), r.nombre).toEqual([]);
    }
  });
});

describe("los graders de la conversión", () => {
  const ctx = (o: Partial<ContextoDeCalificacion>) => ({ conversacion: [], traza: [], ...o }) as unknown as ContextoDeCalificacion;

  it("se-convirtio-en-app: una app sin páginas, sí; con páginas o sin app, no", async () => {
    const g = seConvirtioEnApp();
    expect((await g.calificar(ctx({ datos: caso.solucion }))).paso).toBe(true);
    expect((await g.calificar(ctx({ datos: rota("con-paginas-sueltas") }))).paso).toBe(false);
    expect((await g.calificar(ctx({ datos: caso.inicio }))).paso).toBe(false);
  });

  it("avisa-de-lo-que-se-pierde mira lo que DIJO Len —su texto o su pregunta—, no lo que devolvió la herramienta", async () => {
    const g = avisaDeLoQueSePierde();
    expect(g.puntua).toBe(false);
    const dijo = (texto: string) => ctx({ conversacion: [{ quien: "len", texto }] });
    expect((await g.calificar(dijo(caso.solucionTurno!.len[0]!))).paso).toBe(true);
    expect((await g.calificar(dijo("Hecho: ya es una app."))).paso).toBe(false);
    const pregunta = ctx({
      traza: [{ role: "assistant", content: "", functionCalls: [{ name: "ask_user_question", args: { questions: [{ question: "¿La convierto en app? Se pierde la edición a mano en el lienzo y la traducción automática." }] } }] }],
    });
    expect((await g.calificar(pregunta)).paso).toBe(true);
    const herramienta = ctx({
      traza: [{ role: "user", content: "", functionResponses: [{ name: "convert_to_app", response: { tool_result: "the canvas can't be edited by hand and pages aren't translated automatically" } }] }],
    });
    expect((await g.calificar(herramienta)).paso).toBe(false);
  });
});
