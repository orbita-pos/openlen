// Lo que comparten los cuatro casos de resultados (plans/len-resultados/).
import { sigueAhi } from "@/lib/len-bench/graders";
import type { Grader } from "../../tipos";
import { NOMBRE, TELEFONO } from "./sembrar";

export { deLen } from "./lectura";

/** Regla 4 de Len-Bench (lo que NO se pidió tocar): a quien pregunta por sus
 *  resultados no se le toca la página. */
export function laPaginaSigue(peso = 1): Grader {
  return sigueAhi("la-pagina-sigue", "/", [new RegExp(NOMBRE), /Pan dulce y pasteles por encargo/, new RegExp(TELEFONO)], peso);
}

export function preguntoAlServidor(herramienta: string, peso = 1): Grader {
  return {
    nombre: "pregunto-al-servidor",
    peso,
    async calificar(ctx) {
      const paso = ctx.herramientas.includes(herramienta);
      return { paso, explicacion: paso ? `llamó a ${herramienta}` : `no llamó a ${herramienta} (llamó: ${ctx.herramientas.join(", ") || "nada"})` };
    },
  };
}
