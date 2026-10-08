// lib/len-bench/conversion.ts — UNA PÁGINA QUE SE CONVIERTE EN APP (F4 de la
// spec local 2026-10-07-apps): lo que sólo se mide en ese encargo.
//
//   · `se-convirtio-en-app`: el proyecto acabó siendo una app —`data.app`— y
//     sin páginas sueltas (en una app las páginas pasan a pantallas). Lee la
//     fila final; $0.
//   · `avisa-de-lo-que-se-pierde`: Len le dijo al dueño, con sus palabras, que
//     en una app se pierden la edición a mano en el lienzo y la traducción
//     automática. Mira lo que Len DIJO —su texto y la pregunta de
//     `ask_user_question`—, nunca lo que le devolvieron las herramientas (el
//     resultado de `convert_to_app` ya lo dice, en inglés, y no cuenta). Nuevo
//     y sin corpus: corre, se reporta y NO vota.

import type { Grader } from "./tipos";

export function seConvirtioEnApp(peso = 3): Grader {
  return {
    nombre: "se-convirtio-en-app",
    peso,
    async calificar(ctx) {
      if (!ctx.datos.app) return { paso: false, explicacion: "el proyecto sigue siendo una página: no tiene data.app" };
      const sueltas = Object.keys(ctx.datos.pages ?? {});
      return sueltas.length === 0
        ? { paso: true, explicacion: "es una app, sin páginas sueltas" }
        : { paso: false, explicacion: `es una app pero le quedan páginas: ${sueltas.map((s) => `/${s}/`).join(", ")}` };
    },
  };
}

/** Lo que pierde una página al volverse app, dicho por Len en cualquier idioma razonable del dueño. */
const LIENZO = /lienzo|a mano|editar(?:la)? directamente|edici[oó]n visual|canvas|by hand/i;
const TRADUCCION = /tradu|translat/i;

export function avisaDeLoQueSePierde(peso = 2): Grader {
  return {
    nombre: "avisa-de-lo-que-se-pierde",
    peso,
    puntua: false,
    async calificar(ctx) {
      const dicho = [
        ...ctx.conversacion.filter((x) => x.quien === "len").map((x) => x.texto),
        // La pregunta con la que lo propone (`ask_user_question`): son SUS palabras.
        ...ctx.traza
          .filter((m) => m.role === "assistant")
          .flatMap((m) => m.functionCalls ?? [])
          .filter((c) => c.name === "ask_user_question")
          .map((c) => JSON.stringify(c.args ?? {})),
      ];
      return dicho.some((t) => LIENZO.test(t) && TRADUCCION.test(t))
        ? { paso: true, explicacion: "Len avisó de que se pierden la edición en el lienzo y la traducción automática" }
        : { paso: false, explicacion: `Len no avisó de lo que se pierde; lo último que dijo: «${(dicho.at(-1) ?? "").slice(0, 160)}»` };
    },
  };
}
