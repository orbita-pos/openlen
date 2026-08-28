import { parse, type HTMLElement } from "node-html-parser";

import { MAX_PASOS, parseBehaviorSpec, type PasoSpec, type SpecRechazo } from "@/lib/agent/behavior-spec";



// lib/ai-stream/model-prueba.ts — que el modelo declare QUÉ DEBE PASAR también
// al CREAR, no sólo al editar.
//
// LA ASIMETRÍA QUE CIERRA. El Agente lo tiene desde el 2026-08-22: manda
// `prueba` como parámetro de `editar_pagina`, un navegador la ejecuta y, si
// falla, el modelo lo arregla en ese mismo turno. Al crear no existía nada
// equivalente — la página nacía, se fotografiaba y se entregaba. Los ojos
// recogen lo que EXPLOTA; una promesa incumplida no explota.
//
// EL TRANSPORTE, y por qué éste. Al crear no hay herramienta con parámetros:
// el modelo escribe UN documento y ya. Así que la prueba viaja como el
// JavaScript ya viaja — un `<script>` marcado que OpenLen saca del texto CRUDO
// y NUNCA persiste. Es el mismo mecanismo que `data-openlen-model-runtime`, con
// el mismo destino: se lee, se usa y se tira antes de que nada toque el disco.
//
// ⚠️ ESTO NO ES UNA CONDUCTA. Las conductas (`data-ol-calc` y las demás) eran
// marcado que la PÁGINA llevaba puesto y que un runtime nuestro interpretaba en
// casa del visitante; se retiraron el 2026-08-23 porque el JavaScript libre las
// sustituye. Esto no llega nunca a la página: el saneador borra todo `<script>`,
// y además se extrae antes. Es transporte, no vocabulario que la página cargue.
//
// PURO: reconocer, validar y devolver. Quien la ejecuta es el motor de página
// (`lib/page-engine/prepare.ts`), en el mismo navegador que ya estaba abierto.

/** El marcador del bloque. Un marcador NO confiere autoridad —el HTML pegado
 *  por un usuario puede llevarlo— y por eso esto sólo se llama sobre la
 *  respuesta directa del modelo, igual que el runtime. */
export const MODEL_PRUEBA_ATTR = "data-openlen-prueba";

/** 4 KiB. Seis pasos con selectores caben de sobra; un JSON más grande que eso
 *  es el modelo escribiendo una suite dentro de una generación. */
export const MAX_PRUEBA_BYTES = 4 * 1024;

/** Cómo entrega quien lee el bloque. Crear escribe UN documento y la prueba
 *  viaja dentro; el Chat escribe `<edits>` y viaja al lado. Enseñarle al Chat
 *  la forma del documento sería enseñarle una sintaxis que su superficie no
 *  acepta: la copiaría y la prueba se tiraría en silencio. Mismo criterio que
 *  `RuntimeEditEnvelope` en model-runtime.ts. */
export type PruebaEnvelope = "documento" | "edits";

export type PruebaRechazo = "ausente" | "varios" | "demasiado_grande" | "json_invalido" | SpecRechazo;

export type PruebaExtraction =
  | { readonly ok: true; readonly pasos: readonly PasoSpec[] }
  | { readonly ok: false; readonly reason: PruebaRechazo };

/**
 * Saca la prueba del documento crudo del modelo.
 *
 * FAIL-SOFT hasta el final: cualquier desviación devuelve un motivo y la página
 * sigue su camino sin prueba. No medir no es medir mal — es exactamente el
 * mismo criterio con el que el Agente trata una spec mal formada, y la razón es
 * la misma: una prueba que no se pudo correr no acusa a nadie.
 */
export function extractModelPrueba(rawHtml: string): PruebaExtraction {
  let lista: HTMLElement[];
  try {
    lista = parse(rawHtml).querySelectorAll(`script[${MODEL_PRUEBA_ATTR}]`);
  } catch {
    return { ok: false, reason: "ausente" };
  }

  if (lista.length === 0) return { ok: false, reason: "ausente" };
  // Varias pruebas no se fusionan, por el mismo motivo que varios runtimes: no
  // sabríamos cuál quiso el modelo, y elegir por él es inventar una promesa.
  if (lista.length > 1) return { ok: false, reason: "varios" };

  const texto = lista[0]!.rawText;
  if (Buffer.byteLength(texto, "utf8") > MAX_PRUEBA_BYTES) {
    return { ok: false, reason: "demasiado_grande" };
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, reason: "json_invalido" };
  }

  // EL MISMO validador que el Agente, no uno parecido. Un vocabulario que se
  // acepta al crear y se rechaza al editar son dos productos con un nombre.
  const spec = parseBehaviorSpec(crudo);
  if (spec.kind === "spec") return { ok: true, pasos: spec.pasos };
  return { ok: false, reason: spec.kind === "error" ? spec.reason : "ausente" };
}

/**
 * La misma prueba, en el sobre del CHAT.
 *
 * Al crear, el modelo entrega UN documento y la prueba viaja dentro como un
 * `<script>` marcado. En la pestaña Chat entrega un bloque `<edits>`, así que
 * viaja al lado: `<prueba>[…]</prueba>` DESPUÉS de `</edits>`. Fuera del
 * bloque a propósito — dentro sería un hijo que `parseOps` tendría que
 * aprender a ignorar, y ese parser vive en Rust.
 *
 * Devuelve `ausente` cuando no hay bloque, que no es un error: la mayoría de
 * los turnos del Chat no tocan el comportamiento y no tienen nada que probar.
 */
export function extractPruebaFromEdits(raw: string): PruebaExtraction {
  const bloques = [...raw.matchAll(/<prueba>([\s\S]*?)<\/prueba>/gi)];
  if (bloques.length === 0) return { ok: false, reason: "ausente" };
  if (bloques.length > 1) return { ok: false, reason: "varios" };

  const texto = bloques[0]![1]!.trim();
  if (Buffer.byteLength(texto, "utf8") > MAX_PRUEBA_BYTES) {
    return { ok: false, reason: "demasiado_grande" };
  }
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, reason: "json_invalido" };
  }
  const spec = parseBehaviorSpec(crudo);
  if (spec.kind === "spec") return { ok: true, pasos: spec.pasos };
  return { ok: false, reason: spec.kind === "error" ? spec.reason : "ausente" };
}

/**
 * Lo que se le pide al modelo, y sólo cuando puede escribir JavaScript.
 *
 * Va PEGADO al bloque del runtime (`modelRuntimePromptBlock`) y con el mismo
 * interruptor: una prueba sin script que probar no tiene autor. Con el
 * interruptor apagado devuelve cadena vacía y ninguna generación paga un token.
 *
 * El vocabulario es el del Agente palabra por palabra —«nace MUDO», «la consola
 * limpia», la ruleta que gira y no para— porque es el mismo modelo leyendo la
 * misma promesa por dos superficies distintas.
 */
export function modelPruebaPromptBlock(
  envelope: PruebaEnvelope = "documento",
): string {
  const como =
    envelope === "documento"
      ? `Si escribes ese bloque, escribe TAMBIÉN justo después qué debe pasar al usarlo:
<script type="application/json" ${MODEL_PRUEBA_ATTR}>
[{"clic":"#empezar","entonces":[{"donde":"#reloj","que":"cambia"}]}]
</script>`
      : `Si un turno tuyo cambia el COMPORTAMIENTO de la página —da igual si con \`target="runtime"\` o reescribiéndola entera— manda TAMBIÉN qué debe pasar al usarlo, DESPUÉS del \`</edits>\`:
</edits>
<prueba>[{"clic":"#empezar","entonces":[{"donde":"#reloj","que":"cambia"}]}]</prueba>`;
  return `

DECLARA LA PRUEBA DE TU JAVASCRIPT
${como}
Se ejecuta en un navegador de verdad justo después de guardar: si falla, te lo digo con el elemento y lo que se esperaba, y lo arreglas.
Cada paso: {"clic":"#selector", "veces":N, "escribe":{"#campo":"valor"}, "entonces":[{"donde":"#selector", "que":"cambia"|"contiene"|"es"|"visible"|"oculto", "valor":"texto"}]}. Máximo ${MAX_PASOS} pasos. Selectores simples y de UN solo elemento (#id, .clase, etiqueta): un selector ambiguo hace la prueba mentirosa.
Prueba la PROMESA, no el detalle: que el contador avance, que el filtro enseñe otra cosa, que el modal se abra. Recoger errores sólo ve lo que EXPLOTA, y los dos fallos que de verdad ocurren no explotan — un botón cableado a nada nace MUDO, con la consola limpia, y una cuenta atrás puede arrancar y no parar nunca.
No compares contra un valor exacto que dependa del reloj o del azar: comprueba que CAMBIA.
${envelope === "documento" ? "Ninguno de estos dos bloques llega a la página publicada." : "Y NUNCA digas que probaste algo si no mandaste este bloque: no se probó."}`;
}
