// REPARAR, no volver a escribir.
//
// Cuando la medición encuentra un defecto en la página recién creada, la ruta
// pedía la PÁGINA ENTERA otra vez, desde el brief. Dos problemas medidos:
//
//   1. **Puede perder lo que ya estaba bien.** Es el mismo fallo que el
//      rediseño del Agente ya tenía contado: la foto del dueño desaparecía en
//      8 de 20 turnos. Una reescritura no sabe qué conservar.
//   2. **Cuesta una página de salida** (~8.800 tokens medidos), que es la parte
//      cara. Un arreglo quirúrgico son unos cientos.
//
// Y está MEDIDO que el modelo repara bien cuando se le enseña su propio
// trabajo: 90% de líneas idénticas, 13/13 identificadores conservados
// ([[model-repairs-not-recreates-measured]]). No hacía falta un modelo mejor —
// hacía falta enseñarle lo que ya había escrito.
//
// Usa el MISMO protocolo de ops que el Chat y el Agente (`data-op-id` +
// `<edits>`), y los mismos objetivos reservados: `runtime` para el JavaScript,
// `styles` para el CSS, `head` para la cabecera. Un defecto de `fill:none` es
// una op de `styles`; un botón que revienta es una op de `runtime`. Sin ellos
// la reparación sólo alcanzaría el markup, que es donde MENOS defectos hay.
//
// Precedente del patrón: `lib/style-match/autofill/fill-from-page.ts` ya conduce
// ops fuera de la ruta del Chat.

import { callModel } from "@/lib/style-match/autofill/model-call";
import { applyOps, parseOps, rejectDocumentWideOps, stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import { splitRuntimeOps } from "@/lib/ai-stream/model-runtime";
import {
  applyHeadOp,
  applyLangOp,
  applyStylesOp,
  splitDocumentOps,
  splitLangOp,
} from "@/lib/ai-stream/document-ops";

const MAX_OUTPUT_TOKENS = 8_192;
const TEMPERATURE = 0.3;

const SISTEMA = `Eres un ingeniero arreglando UNA página HTML que acabas de escribir. Un navegador la renderizó y midió defectos concretos.

REPARA LO QUE SE TE DICE. Nada más. No rediseñes, no "mejores" el copy, no toques lo que no está en la lista: la página ya es la que el usuario quiere salvo por esos defectos.

Devuelve SOLO un bloque de ediciones, sin prosa alrededor:

<edits>
<edit target="OP_ID" op="replace">HTML nuevo del elemento COMPLETO, con su etiqueta de apertura y cierre</edit>
</edits>

\`target\` es el valor \`data-op-id\` del elemento, que ya viene puesto en el documento de abajo. \`op\` puede ser "replace", "insert_before", "insert_after" o "delete".

Hay CUATRO objetivos que no son elementos, porque \`<head>\`, \`<style>\` y \`<script>\` no llevan \`data-op-id\`:

- \`target="styles"\` con op="insert_after" — añade reglas CSS al final de tu hoja. Es la forma de arreglar un color ilegible, un \`fill\` que falta en un SVG, o un ancho que se desborda en móvil.
- \`target="head"\` con op="insert_after" — el \`<link>\` de una hoja de fuentes, el \`<title>\` o una \`<meta name>\`.
- \`target="runtime"\` con op="replace" — el JavaScript de la página. Manda el script COMPLETO y corregido; es la ÚNICA forma de cambiar el comportamiento.
- \`target="idioma"\` con op="replace" — el código de idioma del \`<html>\`.

REGLAS DURAS:
- NUNCA apuntes al \`data-op-id\` del \`<body>\` o del \`<html>\`: eso reemplazaría la página entera y es exactamente lo que esto existe para evitar.
- Un selector CSS sólo aplica si el elemento lleva esa clase. Si el arreglo es conectar los dos, añade la clase al elemento con un \`replace\`.
- Si un defecto dice que TU PROPIA PRUEBA falló, lo que está mal es el CÓDIGO, no la prueba: arréglalo con \`target="runtime"\`. La prueba no se puede cambiar desde aquí.
- Si un defecto no se puede arreglar con una edición acotada, NO lo intentes: omítelo y arregla los demás.`;

export interface RepairResult {
  readonly ok: boolean;
  /** El documento reparado, sin `data-op-id`. Sólo cuando `ok`. */
  readonly html?: string;
  /** El JavaScript corregido, si la reparación lo tocó. */
  readonly runtime?: string | null;
  readonly appliedOps?: number;
  readonly reason?: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

/**
 * Un intento de arreglo quirúrgico. NUNCA lanza: cualquier fallo devuelve
 * `ok:false` y el llamador se queda con lo que ya tenía o cae a la reescritura
 * completa, que es el comportamiento de antes de que esto existiera.
 */
export async function repairGeneratedPage(
  input: {
    readonly html: string;
    readonly runtime: string | null;
    readonly defectos: readonly string[];
    readonly brief: string;
    readonly signal?: AbortSignal;
  },
  /** Sólo para las pruebas: la llamada real vive en `model-call.ts`. */
  internals: { readonly call?: typeof callModel } = {},
): Promise<RepairResult> {
  if (input.defectos.length === 0) return { ok: false, reason: "sin_defectos" };

  const { taggedHtml, taggedCount } = tagWithOpIds(stripOpIds(input.html));
  if (taggedCount === 0) return { ok: false, reason: "sin_elementos" };

  // Su propio JavaScript, FUERA del documento. Sin esto el modelo no puede
  // arreglar el comportamiento: `html` viene saneado —sin scripts— y lo que no
  // ve, lo re-inventa.
  const bloqueJs = input.runtime
    ? `\n\nEL JAVASCRIPT ACTUAL DE LA PÁGINA (para editarlo, manda el script COMPLETO corregido en un edit con target="runtime"):\n\`\`\`js\n${input.runtime}\n\`\`\``
    : "";

  const user =
    `LA PÁGINA PEDÍA: ${input.brief.slice(0, 400)}\n\n` +
    `DEFECTOS MEDIDOS POR EL NAVEGADOR (no son opiniones):\n` +
    input.defectos.map((d) => `- ${d}`).join("\n") +
    bloqueJs +
    `\n\nDOCUMENTO ACTUAL (cada elemento editable lleva su \`data-op-id\`):\n${taggedHtml}`;

  const res = await (internals.call ?? callModel)({
    system: SISTEMA,
    user,
    operation: "page_edit",
    requestId: `generate.repair.${Math.random().toString(36).slice(2, 10)}`,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!res.ok) return { ok: false, reason: res.message };

  const { ops } = parseOps(res.raw);
  if (ops.length === 0) return { ok: false, reason: "sin_ops", ...(res.usage ? { usage: res.usage } : {}) };

  // El reparto es el MISMO de `editar_pagina`, y en el mismo orden: primero se
  // apartan los objetivos que no son elementos, y lo que queda pasa por la
  // guarda que impide reemplazar la página entera.
  const conRuntime = splitRuntimeOps(ops);
  const documento = splitDocumentOps(conRuntime.domOps);
  const idioma = splitLangOp(documento.domOps);
  const { ops: domOps } = rejectDocumentWideOps(taggedHtml, idioma.domOps);

  const nuevoRuntime = conRuntime.runtime.kind === "codigo" ? conRuntime.runtime.code : null;
  const tocaDocumento = documento.styles.kind !== "ninguna" || documento.head.kind !== "ninguna";
  if (domOps.length === 0 && nuevoRuntime === null && !tocaDocumento && idioma.lang.kind === "ninguna") {
    return { ok: false, reason: "ops_no_aplicables", ...(res.usage ? { usage: res.usage } : {}) };
  }

  let html = taggedHtml;
  let aplicadas = 0;
  if (domOps.length > 0) {
    const applied = applyOps(taggedHtml, domOps);
    if (applied.html === null) {
      return { ok: false, reason: applied.errors[0]?.reason ?? "no_aplicaron", ...(res.usage ? { usage: res.usage } : {}) };
    }
    html = applied.html;
    aplicadas = applied.appliedCount;
  }
  html = applyLangOp(applyHeadOp(applyStylesOp(html, documento.styles), documento.head), idioma.lang);

  return {
    ok: true,
    // Los `data-op-id` son marcadores de modo edición y NUNCA se persisten.
    html: stripOpIds(html),
    runtime: nuevoRuntime ?? input.runtime,
    appliedOps: aplicadas + (nuevoRuntime ? 1 : 0) + (tocaDocumento ? 1 : 0),
    ...(res.usage ? { usage: res.usage } : {}),
  };
}
