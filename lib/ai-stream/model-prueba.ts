import {
  pareceJs,
  pruebaJsPromptBlock,
  validaPruebaJs,
  type PruebaDeclarada,
} from "@/lib/agent/prueba-js";

// lib/ai-stream/model-prueba.ts — que el modelo del CHAT declare QUÉ DEBE PASAR
// cuando edita, igual que el Agente con `prueba_js`.
//
// EL TRANSPORTE. El Chat no tiene herramienta con parámetros: entrega un bloque
// `<edits>`, así que la prueba viaja al lado, `<prueba>…</prueba>` DESPUÉS de
// `</edits>`. Fuera del bloque a propósito — dentro sería un hijo que
// `parseOps` tendría que aprender a ignorar, y ese parser vive en Rust.
//
// ⚰️ AQUÍ HABÍA OTRO SOBRE, el del DOCUMENTO: un `<script data-openlen-prueba>`
// dentro de la página, para Crear y para la reescritura del Chat. Crear dejó de
// pedir prueba el 2026-09-05 (lo guarda `app/api/generate/system-prompt.test.ts`)
// y la reescritura nunca lo enseñó, así que su lector no tenía quien le
// escribiera. Y no era inocuo: la reescritura guarda el documento tal cual, y un
// programa en ese `<script>` sin `type` se habría ejecutado en la página. Se
// retiró el 2026-09-22 con el DSL.
//
// ⚰️ Y EL DSL. Hasta el 2026-09-22 el bloque traía una lista de pasos en JSON y
// la validaba el mismo parser que el Agente. Desde ese día la promesa es un
// programa sobre los primitivos `ui.*` (`lib/agent/prueba-js.ts`), la misma que
// el Agente manda en `prueba_js`. Un JSON que siga llegando —un modelo que copia
// su propio historial— se rechaza con su nombre en vez de convertirse: una
// conversión se escribe cuando ese error es frecuente, no por si acaso.
//
// PURO: reconocer, validar y devolver. Quien la ejecuta es el motor de página
// (`lib/page-engine/prepare.ts`), en el mismo navegador que ya estaba abierto.

export type PruebaRechazo = "ausente" | "varios" | "vacia" | "demasiado_grande" | "prueba_retirada";

export type PruebaExtraction =
  | { readonly ok: true; readonly prueba: PruebaDeclarada }
  | { readonly ok: false; readonly reason: PruebaRechazo };

/**
 * Saca la prueba de detrás del bloque `<edits>`.
 *
 * Devuelve `ausente` cuando no hay bloque, que no es un error: la mayoría de
 * los turnos del Chat no tocan el comportamiento y no tienen nada que probar.
 *
 * FAIL-SOFT: cualquier otra desviación devuelve un motivo y el cambio sigue su
 * camino sin prueba. El Chat no reintenta dentro del turno, así que rechazar el
 * turno entero tiraría un cambio ya pagado por una comprobación mal escrita.
 * Lo que NO puede es callarse: el motivo se le dice con `avisoPruebaDescartada`.
 */
export function extractPruebaFromEdits(raw: string): PruebaExtraction {
  const bloques = [...raw.matchAll(/<prueba>([\s\S]*?)<\/prueba>/gi)];
  if (bloques.length === 0) return { ok: false, reason: "ausente" };
  // Varias pruebas no se fusionan: no sabríamos cuál quiso el modelo, y elegir
  // por él es inventar una promesa.
  if (bloques.length > 1) return { ok: false, reason: "varios" };

  const texto = bloques[0]![1]!.trim();
  if (texto && !pareceJs(texto)) return { ok: false, reason: "prueba_retirada" };
  const js = validaPruebaJs(texto);
  return js.ok ? { ok: true, prueba: { codigo: js.codigo } } : { ok: false, reason: js.reason };
}

/**
 * Lo que se dice cuando la prueba declarada NO se pudo usar.
 *
 * Va con los demás avisos del turno: lo lee el dueño, y el modelo lo recibe en
 * el turno siguiente por el historial. En primera persona y sin receta, como
 * `notaSpec`: la forma correcta ya se la enseña su prompt, y al dueño una receta
 * de `ui.*` no le sirve de nada. Hasta el 2026-09-22 esto sólo iba a un
 * `console.warn`, y el modelo seguía creyendo que había prometido algo.
 */
export function avisoPruebaDescartada(reason: Exclude<PruebaRechazo, "ausente">): string {
  const porque: Record<Exclude<PruebaRechazo, "ausente">, string> = {
    prueba_retirada: "venía en el formato de pasos, que ya no se usa",
    varios: "venía repetida y no sé cuál de las dos vale",
    vacia: "venía vacía",
    demasiado_grande: "era demasiado larga para ejecutarla",
  };
  return `⚠️ La comprobación que escribí para este cambio ${porque[reason]}, así que no se comprobó. El cambio está guardado.`;
}

/**
 * Lo que se le pide al modelo del Chat.
 *
 * Va PEGADO al bloque del runtime (`modelRuntimePromptBlock`): una prueba sin
 * script que probar no tiene autor. Y sólo en MODE A: el `<prueba>` va detrás
 * de `</edits>`, y la reescritura (MODE B) no tiene `</edits>` — termina en
 * `</html>`, y cualquier cosa detrás la haría rechazar.
 *
 * El vocabulario de `ui.*` es el del Agente palabra por palabra
 * (`pruebaJsPromptBlock`), porque es el mismo modelo leyendo la misma promesa
 * por dos superficies distintas.
 */
export function modelPruebaPromptBlock(): string {
  return `

DECLARA LA PRUEBA DE TU JAVASCRIPT
Si un turno tuyo en MODE A cambia el COMPORTAMIENTO de la página, manda TAMBIÉN qué debe pasar al usarlo, DESPUÉS del \`</edits>\`:
</edits>
<prueba>var antes = await ui.texto("#reloj"); await ui.clic("#empezar"); await ui.cambiaDe("#reloj", antes);</prueba>
Se ejecuta en un navegador de verdad justo después de guardar, y si no se cumple te lo digo con el elemento y lo que se esperaba.
${pruebaJsPromptBlock("El bloque `<prueba>`")}
Prueba la PROMESA, no el detalle: que el contador avance, que el filtro enseñe otra cosa, que el modal se abra. Recoger errores sólo ve lo que EXPLOTA, y los dos fallos que de verdad ocurren no explotan — un botón cableado a nada nace MUDO, con la consola limpia, y una cuenta atrás puede arrancar y no parar nunca.
No compares contra un valor exacto que dependa del reloj o del azar: comprueba que CAMBIA.
Y NUNCA digas que probaste algo si no mandaste este bloque: no se probó.`;
}
