// Lo que comparten los cuatro casos de resultados (plans/len-resultados/).
import { sigueAhi } from "@/lib/len-bench/graders";
import { juez } from "@/lib/len-bench/juez";
import type { Grader } from "../../tipos";
import { NOMBRE, TELEFONO } from "./sembrar";

export { deLen } from "./lectura";

/**
 * EL JUEZ de estos casos (`juez.ts`, el grader `llm` de Claude Code): mira lo
 * que los graders de texto no ven. En el humo del 30/09 dieron 1,00 mientras
 * Len se inventaba que las visitas eran «de previsualizaciones». UN criterio,
 * juzgable leyendo sólo la conversación, y SIN votar hasta que haya corpus
 * (memoria `llm-judge-is-not-a-ship-gate`; su `scored: false`).
 */
export function sinSuposiciones(): Grader {
  return juez({
    nombre: "sin-suposiciones",
    foco: "conversacion",
    puntua: false,
    criterio:
      "Todo lo que el agente afirma sobre las visitas, los formularios o los mensajes del usuario es un dato concreto " +
      "(un número, un nombre, una fecha, lo que alguien escribió), una pregunta o una oferta de ayuda. " +
      "FAIL si añade una explicación o una suposición sobre por qué los datos son así o de dónde salen " +
      "(por ejemplo, que las visitas son de pruebas, del editor o de la vista previa) sin decir que es una suposición.",
  });
}

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
