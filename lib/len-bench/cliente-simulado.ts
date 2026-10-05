// lib/len-bench/cliente-simulado.ts — el dueño, FIJO.
//
// Existe para medir si Len PREGUNTA el dato que le falta o se lo INVENTA (el
// fallo de `lada-que-nadie-dio`, rojo en 1.5): los mensajes del dueño son el
// guion de cada caso, escrito de antemano, y cuando Len usa `preguntar` le
// contesta esto.
//
// 🔴 CAMBIÓ EL 2026-09-27: era un MODELO (la forma de τ-bench) y ahora es un
// doble FIJO, como los `fixed` de las evals de Claude Code, que no tienen
// usuario simulado y sólo usan dobles para las herramientas: fijos, o un modelo
// con guardas y grabado para repetirse igual. El modelo, sin nada de eso,
// contestaba distinto cada corrida y empujaba: aceptaba lo que Len ofrecía
// («sí, cablea los botones») y añadía encargos, pedía «sigue con lo que falta»
// sin que faltara nada, parafraseaba las reseñas de la ficha y citaba valores
// que no eran suyos (V4, V6, V7 y la revisión del sellado:
// `plans/len-2/revision-2026-09-27/`). Ahora: `preguntar` → la ficha tal cual;
// cualquier otra cosa → el siguiente mensaje del guion. Y cuesta $0.
//
// 🔴 EL CLIENTE NO CALIFICA. Los que deciden si Len acertó son los graders,
// sobre la web publicada.

import type { EventoSse } from "./sse";
import { isQuestionTool } from "@/lib/agent/ask-user-question";
import {
  correosDe,
  esElTelefonoDado,
  ladasDadas,
  numerosDeContacto,
  preciosConPorcentaje,
  preciosDe,
  soloDigitos,
  telefonosDe,
  textoVisible,
} from "./extraer";
import type { Ficha, Intercambio, PasoDelGuion } from "./tipos";

/** Cuántas veces puede contestar el dueño dentro de un mismo paso. */
export const MAX_RESPUESTAS_POR_PASO = 3;

export type Decision = { accion: "responder"; mensaje: string } | { accion: "siguiente" };

/**
 * LO QUE CONTESTA EL DUEÑO CUANDO LEN PREGUNTA: su ficha entera, cada dato TAL
 * CUAL, y que lo demás no lo tiene. Es el cuerpo de un doble `fixed`: la misma
 * respuesta en cada corrida, sea cual sea la pregunta. Los «gustos» de la ficha
 * no van: se escribieron como pistas para el modelo que hacía de dueño («no
 * sabes nada de ninguna nota»), no como algo que el dueño diga.
 */
export function respuestaFija(ficha: Ficha): string {
  // Con su nombre: «2012» suelto no dice que es el año en que abrieron.
  const datos = Object.entries(ficha.datos).map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`);
  const falta = "Lo que no esté aquí no lo tengo: déjalo como está.";
  return datos.length > 0 ? `Esto es lo que tengo:\n${datos.join("\n")}\n${falta}` : `No lo tengo: déjalo como está.`;
}

/**
 * ¿Len le PREGUNTÓ algo al dueño en este turno? Sólo cuenta la herramienta
 * `preguntar` terminada (las dos versiones de la ruta la emiten como `action`):
 * un «¿te parece?» al final del texto es una oferta o una cortesía, y un doble
 * fijo no adivina cuál de las dos.
 */
export function preguntoLen(eventos: readonly EventoSse[]): boolean {
  return eventos.some((e) => {
    const d = e.datos as { tool?: unknown; status?: unknown } | null;
    // Con el nombre de hoy (`ask_user_question`, pieza 3) o el de antes.
    return e.nombre === "action" && typeof d?.tool === "string" && isQuestionTool(d.tool) && d.status === "done";
  });
}

/**
 * Lo DADO es lo mismo que en `nada-inventado` (graders.ts): la ficha, la
 * PARTIDA y lo que el dueño ya dijo. El dueño que cita el precio de su propia
 * página no inventa nada (calibración del 2026-09-24: «el mío está en $52»,
 * su espresso, salió como fallo del arnés).
 */
export function respetaLaFicha(
  mensaje: string,
  ficha: Ficha,
  partida = "",
  dicho: readonly string[] = [],
): { ok: true } | { ok: false; dato: string } {
  const valores = Object.values(ficha.datos);
  const base = [partida, ...dicho].join("\n");
  const visible = textoVisible(base);
  const telsFicha = [...valores.flatMap((v) => telefonosDe(v)), ...telefonosDe(visible), ...numerosDeContacto(base)];
  const correosFicha = new Set([...valores.flatMap((v) => correosDe(v)), ...correosDe(visible)]);
  const preciosFicha = new Set([...valores.flatMap((v) => preciosDe(v)), ...preciosDe(visible)]);
  // La misma regla que los graders (`esElTelefonoDado`): el dueño que da su
  // número sin la lada que tiene la ficha no inventa nada; con una lada que la
  // ficha no tiene, sí. Una segunda regla aquí acabaría separándose de aquélla.
  // Y lo que V1 le enseñó a `nada-inventado` y aquí faltaba: la lada que el
  // dueño confirma (también nombrando el país) y el precio con el porcentaje
  // que él dio. Sin esto, el cliente que REPITE lo que acaba de decir Len
  // («sí, 70,20 €» tras pedir un 10 %) salía fuera de ficha (E del 26/09,
  // codigo-de-descuento dos veces). Sólo de lo que dijo ANTES, como allí: un
  // «+1» o un «10 %» en el mismo mensaje se darían por buenos a sí mismos.
  const ladas = ladasDadas(dicho.join("\n"));
  const conPorcentaje = preciosConPorcentaje(preciosFicha, visible);
  for (const t of telefonosDe(mensaje)) {
    if (!telsFicha.some((f) => esElTelefonoDado(t, f) || ladas.some((l) => t === l + soloDigitos(f)))) return { ok: false, dato: t };
  }
  for (const c of correosDe(mensaje)) if (!correosFicha.has(c)) return { ok: false, dato: c };
  for (const p of preciosDe(mensaje)) {
    if (!preciosFicha.has(soloDigitos(p)) && !conPorcentaje.has(p)) return { ok: false, dato: `$${p}` };
  }
  return { ok: true };
}

/**
 * El dueño decide qué contestar. Fijo: si Len usó `preguntar`, la respuesta de
 * la ficha; si no —terminó, informó u OFRECIÓ algo—, el siguiente mensaje del
 * guion. Nunca «sí, hazlo» ni «sigue con lo que falta». La forma (asíncrona, con
 * `ok`, `usd`) se queda para no romper a quien la llama; `pregunto` sin dar es
 * «no preguntó».
 */
export async function decidirComoCliente(o: {
  readonly ficha: Ficha;
  readonly paso: PasoDelGuion;
  readonly conversacion: readonly Intercambio[];
  readonly pregunto?: boolean;
}): Promise<{ ok: true; decision: Decision; usd: number } | { ok: false; motivo: string }> {
  const decision: Decision = o.pregunto ? { accion: "responder", mensaje: respuestaFija(o.ficha) } : { accion: "siguiente" };
  return { ok: true, decision, usd: 0 };
}
