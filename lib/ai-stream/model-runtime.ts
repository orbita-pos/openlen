import vm from "node:vm";
import { parse, type HTMLElement } from "node-html-parser";

// lib/ai-stream/model-runtime.ts — sacar el runtime que escribió el modelo de
// su respuesta CRUDA, antes de que el sanitizador lo borre.
//
// Etapa 1 de abrir JavaScript. Aquí NO se ejecuta nada y NO se publica nada:
// sólo se reconoce un script, se comprueba que cumple el contrato y se devuelve
// su texto exacto. Guardarlo, autorizarlo y publicarlo son etapas posteriores.
//
// DOS COSAS QUE NO SE RELAJAN:
//   · Se lee del texto CRUDO del proveedor. El HTML que se guarda y el que se
//     emite en vivo siguen pasando por el sanitizador de siempre — nunca se usa
//     `sanitize: false`, porque ese interruptor no sólo suelta los scripts:
//     también suelta manejadores `on*`, URLs peligrosas e iframes.
//   · Los bytes que salen de aquí son los del modelo, sin tocar. Cualquier
//     recorte, normalización o reserialización rompería el hash que la Etapa 2
//     calculará sobre ellos.

/** El atributo que marca el runtime. Un marcador NO confiere autoridad por sí
 *  solo —el HTML pegado por un usuario puede llevarlo— y por eso esto sólo se
 *  llama sobre la respuesta directa del modelo. */
export const MODEL_RUNTIME_ATTR = "data-openlen-model-runtime";

/** 32 KiB. Una interacción de página cabe de sobra; un bundle no. El tope
 *  existe porque esto acaba en una columna y en un hash, y un script sin techo
 *  es una forma barata de engordar cada generación. */
export const MAX_RUNTIME_BYTES = 32 * 1024;

export type RuntimeRejection =
  | "ausente"
  | "varios"
  | "con_src"
  | "modulo"
  | "vacio"
  | "demasiado_grande"
  | "marcador_de_editor"
  | "sintaxis";

export type RuntimeExtraction =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: RuntimeRejection };

/**
 * Comprueba que el texto compila SIN ejecutarlo.
 *
 * `new vm.Script(code)` parsea y lanza en un error de sintaxis, pero no corre
 * una sola instrucción. Es lo que evita guardar un script que nunca podría
 * funcionar — y descubrirlo en la página del usuario en vez de aquí.
 *
 * Que compile no dice NADA sobre lo que hace. Eso lo decide el origen y la CSP,
 * no un parser.
 */
function compila(code: string): boolean {
  try {
    new vm.Script(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saca el runtime del documento crudo del modelo.
 *
 * Contrato del piloto: EXACTAMENTE un `<script data-openlen-model-runtime>`
 * inline, clásico, al final del body. Cualquier desviación se rechaza con un
 * motivo — no se intenta arreglar. Un contrato que se auto-repara deja de ser
 * un contrato, y aquí lo que está en juego es qué código acaba ejecutándose en
 * la página de un visitante.
 */
export function extractModelRuntime(rawHtml: string): RuntimeExtraction {
  let lista: HTMLElement[];
  try {
    lista = parse(rawHtml).querySelectorAll(`script[${MODEL_RUNTIME_ATTR}]`);
  } catch {
    return { ok: false, reason: "ausente" };
  }

  if (lista.length === 0) return { ok: false, reason: "ausente" };
  // Varios runtimes no se fusionan: no sabríamos en qué orden los quiso el
  // modelo, y adivinarlo es inventar código que nadie escribió.
  if (lista.length > 1) return { ok: false, reason: "varios" };

  const el = lista[0]!;
  const src = el.getAttribute("src");
  if (src !== undefined && src.trim() !== "") return { ok: false, reason: "con_src" };

  const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
  // Un módulo trae `import`, y eso es red: otra petición, otro origen posible.
  // El piloto es un script clásico y nada más.
  if (type === "module") return { ok: false, reason: "modulo" };

  return validateRuntimeCode(el.rawText);
}

/**
 * Las comprobaciones a nivel de CÓDIGO, sin elemento alrededor.
 *
 * Se separó de `extractModelRuntime` cuando el runtime pasó a ser
 * direccionable por ops: ahí el modelo manda el JavaScript dentro de un
 * `<edit target="runtime">`, sin documento del que sacarlo. Las reglas tienen
 * que ser las MISMAS por los dos caminos — un código que se rechaza al crear y
 * se acepta al editar es una puerta trasera con dos llaves.
 */
export function validateRuntimeCode(code: string): RuntimeExtraction {
  if (code.trim() === "") return { ok: false, reason: "vacio" };
  if (Buffer.byteLength(code, "utf8") > MAX_RUNTIME_BYTES) {
    return { ok: false, reason: "demasiado_grande" };
  }
  // `data-slot-path` es marcador de modo editor y `publishToDir` rechaza el
  // documento entero si aparece. Que llegue dentro de un string de JavaScript
  // sería la forma de colarlo sin que el sanitizador lo viera.
  if (code.includes("data-slot-path")) return { ok: false, reason: "marcador_de_editor" };
  if (!compila(code)) return { ok: false, reason: "sintaxis" };

  return { ok: true, code };
}

// `pageAllowsRuntime` VIVÍA AQUÍ y se quitó el 2026-08-21, a petición de Jesús:
// «no debe tirar el JS si hay módulos, prefiero que los módulos los hagamos
// diferente a eso». Descalificaba la página entera si el HTML traía un `<form>`
// o el marcador de un módulo, y el efecto medido era que 1 de cada 6 páginas
// corrientes perdía su JavaScript EN SILENCIO por llevar un formulario de
// contacto.
//
// SE REVIRTIÓ A PROPÓSITO UNA PUERTA QUE PUSO UNA AUDITORÍA (7bc7940c). El
// riesgo real no era el formulario —`form-action` y `connect-src` son `'self'`,
// así que un script sólo alcanza el buzón de su propia página— sino que un
// script actuara como el VISITANTE IDENTIFICADO contra nuestras APIs.
//
// Eso se cerró retirando la causa: el módulo Miembros se fue y con él la cookie
// `ol_member` y `set-password`. De las superficies públicas bajo el subdominio
// quedan `/api/f` (formularios) y `/api/chat`, y ninguna de las 12 rutas del
// chat cambia credenciales — `login` sólo las verifica.
//
// ⚠️ Si algún día vuelve un módulo con sesión de visitante, la puerta vuelve con
// él. El patrón correcto es el de las reservas retiradas: un token HMAC por
// correo, nunca la cookie ambiental.

/** Opt-in EXACTO. Ni "true", ni "yes", ni vacío: sólo "1". Una variable de
 *  entorno mal escrita no puede encender esto por accidente.
 *
 *  El parámetro es deliberadamente MÁS ANCHO que `NodeJS.ProcessEnv`: los
 *  ensambladores de prompt reciben un `Readonly<Record<…>>` para poder pasarles
 *  un entorno de mentira en las pruebas, y `ProcessEnv` —con su índice
 *  mutable— no lo acepta. Ensanchar aquí evita que cada llamador repita la
 *  comparación con `"1"` por su cuenta, que es como se pierde el opt-in exacto. */
export function modelJsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.OPENLEN_MODEL_JS === "1";
}

/**
 * Lo que se le añade al prompt cuando el piloto está encendido.
 *
 * Va aparte del `SYSTEM_PROMPT` a propósito: ese contrato lo comparten la
 * pestaña Chat y el Agente, y esto es exclusivo de crear. Devuelve cadena vacía
 * con el interruptor apagado, así que ninguna generación normal paga un solo
 * token por una capacidad que no puede usar.
 *
 * ORDEN Y TONO, medidos. La versión anterior abría con "(opcional — sólo si esta
 * página gana algo real con ella)", ponía cinco de sus ocho líneas en negativo y
 * CERRABA con "si la página no gana nada, no incluyas el bloque". Leído entero
 * empujaba a omitir, y eso hacía el modelo: 0 de 6 páginas con JavaScript. Aquí
 * el permiso va primero y en afirmativo, con ejemplos de PARA QUÉ sirve, y los
 * límites después y agrupados. Con este orden salieron 2 de 2.
 *
 * Se le dice que el DOM debe funcionar sin el script, y no por cortesía: el
 * runtime puede rechazarse aquí por diez motivos distintos, y una página cuya
 * información sólo existe si el JavaScript corre sería una página vacía.
 */
export function modelRuntimePromptBlock(
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (!modelJsEnabled(env)) return "";
  return `

INTERACCIÓN CON JAVASCRIPT
Puedes escribir el JavaScript de esta página. Va en UN bloque, el último del body:
<script ${MODEL_RUNTIME_ATTR}>
  // JavaScript clásico.
</script>
Úsalo para lo que el CSS no alcanza: filtrar una lista por categoría, una galería con lightbox, pestañas, una cuenta atrás, buscar dentro de la propia página, un carrusel.
Límites: uno solo, en línea, sin \`src\` ni \`type="module"\`, máximo ${Math.floor(MAX_RUNTIME_BYTES / 1024)} KiB, sin red (fetch, XMLHttpRequest, WebSocket y Worker los bloquea la política de la página), y nada que envíe datos de un visitante. Si alguno se incumple se descarta el bloque entero.
La página tiene que estar COMPLETA y legible sin el script: mejora, nunca construye el contenido. Nunca escondas contenido con CSS para revelarlo desde el script — si el script se descarta, la página llega en blanco.`;
}

/**
 * EL CÓDIGO QUE YA TIENE LA PÁGINA, para que el modelo lo pueda REPARAR.
 *
 * POR QUÉ EXISTE. `data.html` se guarda SANEADO: el script del modelo no está
 * dentro. Vive aparte, en `projects.generatedRuntime`, y sólo el publicador los
 * vuelve a juntar (`injectModelRuntime`). Consecuencia MEDIDA: cuando el usuario
 * pedía «arregla el bug del juego», el documento que viajaba al modelo NO LLEVABA
 * EL SCRIPT — así que el modelo no reparaba nada, RE-CREABA la funcionalidad
 * desde cero. Nadie lo notaba porque el resultado funciona; simplemente es otra
 * página, no la tuya arreglada.
 *
 * Va en un bloque APARTE, nunca inyectado dentro del documento que se le enseña.
 * Meterlo ahí lo pondría en el camino de las ops y podría acabar persistido en
 * `data.html`, que es justo el invariante que no se toca.
 *
 * Las dos últimas frases no son cortesía. `resealRuntime` vuelve a atar el
 * código VIEJO a cualquier HTML nuevo que se guarde, así que una reescritura sin
 * script deja la página con un runtime que apunta a elementos que ya no existen.
 * Decírselo es lo que convierte «reescribe» en «reescribe y trae el script».
 */
/** Cómo emite ediciones quien lee este bloque. El Chat manda un sobre XML
 *  `<edits>`; el Agente llama a `editar_pagina` con un array JSON; el rediseño
 *  siempre produce un documento entero y no tiene camino barato. Enseñarle al
 *  Agente el ejemplo en XML sería enseñarle una sintaxis que su superficie no
 *  acepta — el modelo la copiaría y la llamada fallaría. */
export type RuntimeEditEnvelope = "xml" | "tool" | "documento";

function comoCambiarlo(envelope: RuntimeEditEnvelope): string {
  if (envelope === "documento") {
    return `TO CHANGE THE BEHAVIOUR you have to change THIS code: your rewrite must include the corrected \`<script ${MODEL_RUNTIME_ATTR}>\` block. Editing the markup alone never changes behaviour — nothing else on the page runs.`;
  }
  const ejemplo =
    envelope === "xml"
      ? `<edits>
  <edit op="replace" target="${RUNTIME_OP_TARGET}">
    <new><script ${MODEL_RUNTIME_ATTR}>
    …the complete corrected code, not a fragment and not a diff…
    </script></new>
  </edit>
</edits>`
      : `{ "op": "replace", "target": "${RUNTIME_OP_TARGET}", "new_html": "<script ${MODEL_RUNTIME_ATTR}>…the complete corrected code, not a fragment and not a diff…</script>" }`;
  const junto =
    envelope === "xml"
      ? "You may combine it with ordinary markup ops in the same `<edits>` block when the fix needs both."
      : "You may combine it with ordinary markup edits in the same `edits` array when the fix needs both.";
  return `TO CHANGE THE BEHAVIOUR you have to change THIS code. Editing the markup alone never does it — nothing else on the page runs. Two ways, both valid:

• The cheap path (preferred for a bug fix): address it with the reserved target \`${RUNTIME_OP_TARGET}\`, sending the whole corrected script back —

${ejemplo}

  ${junto} \`${RUNTIME_OP_TARGET}\` is the ONLY target that is not an element of the document.

• A full rewrite that includes the corrected \`<script ${MODEL_RUNTIME_ATTR}>\` block.`;
}

export function currentRuntimePromptBlock(
  code: string,
  envelope: RuntimeEditEnvelope = "xml",
): string {
  if (code.trim() === "") return "";
  return `

THIS PAGE ALREADY HAS JAVASCRIPT. It is stored separately and injected when the page is published, which is why it does NOT appear in the document above. This is the code that runs on the live page:

<script ${MODEL_RUNTIME_ATTR}>
${code}
</script>

${comoCambiarlo(envelope)}

If you rewrite the page and its behaviour should survive, RE-EMIT this script, adapted to your new markup. Omitting it does NOT clear the behaviour — the page keeps the script above, and it will reference elements your rewrite may have removed.
NEVER tell the user you fixed the behaviour in a turn where you emitted neither of the two forms above. If you only touched markup, the code above is still what runs, unchanged.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// El runtime como OBJETIVO de una op.
//
// POR QUÉ. El camino barato de edición (Modo A) direcciona elementos por
// `data-op-id`, y `SKIP_TAGS` deja fuera `script` — así que el JavaScript de la
// página era estructuralmente INALCANZABLE desde ahí. MEDIDO el 2026-08-22: el
// modelo diagnosticó un bug de comportamiento con precisión, anunció «I'll fix
// the runtime script», y emitió ops de Modo A. Nada cambió. El usuario leyó
// «ya lo arreglé» sobre un juego que seguía roto, sin un solo error en consola.
//
// El aviso ya estaba en el prompt («Mode A ops cannot reach it»). El modelo lo
// leyó, lo parafraseó bien, y eligió Modo A igual porque la petición sonaba
// pequeña. Un agujero estructural no se tapa pidiendo por favor.
//
// El arreglo es hacer completo el camino barato, no prohibirlo: un objetivo
// reservado que el aplicador de ops nunca llega a ver. `parseOps` ya devuelve
// `target` como string libre, así que el reparto ocurre AQUÍ, en TypeScript,
// entre parsear y aplicar — el crate de Rust no se toca y la equivalencia byte
// a byte del shadow soak queda intacta.

import type { Op } from "@/lib/html-ops";

/** El único objetivo de op que no es un elemento del documento. */
export const RUNTIME_OP_TARGET = "runtime";

export type RuntimeOpRejection =
  | RuntimeRejection
  /** Más de una op contra el runtime: no se fusionan (mismo criterio que
   *  `extractModelRuntime` con dos `<script>`) — no sabríamos en qué orden. */
  | "varias"
  /** `insert_before` / `insert_after` / `delete` sobre un blob de código. */
  | "op_no_soportada";

export type RuntimeOpResult =
  | { readonly kind: "ninguna" }
  | { readonly kind: "codigo"; readonly code: string }
  | { readonly kind: "error"; readonly reason: RuntimeOpRejection };

/**
 * El JavaScript que viene dentro de un `<edit target="runtime">`.
 *
 * Acepta las dos formas que el modelo puede emitir: el `<script>` entero (que
 * es lo que el prompt le enseña, y lo natural porque toda op de `replace` lleva
 * un elemento) o el código pelado. Tolerar las dos cuesta una comprobación y
 * evita perder un arreglo bueno por un envoltorio ausente.
 */
export function runtimeCodeFromOpPayload(payload: string): RuntimeExtraction {
  // Sin expresión regular a propósito: la primera versión llevaba `\b` dentro
  // de un template literal, que en JavaScript es el CARÁCTER de retroceso y no
  // un límite de palabra, así que no casaba nunca y todo script entraba como si
  // fuera código pelado — devolviendo "sintaxis" sobre un arreglo bueno. Dos
  // `includes` no tienen esa trampa.
  const pareceElemento = payload.includes("<script") || payload.includes("<SCRIPT");
  return pareceElemento ? extractModelRuntime(payload) : validateRuntimeCode(payload);
}

/**
 * Aparta las ops que apuntan al runtime antes de que el aplicador vea la tanda.
 *
 * Devuelve SIEMPRE `domOps` sin ellas, incluso cuando el runtime falla: el
 * resto del cambio del usuario no tiene por qué caerse porque el script venga
 * mal. Quien llame decide qué hacer con el error — la doctrina dice avisar, no
 * tragárselo.
 */
export function splitRuntimeOps(ops: readonly Op[]): {
  domOps: Op[];
  runtime: RuntimeOpResult;
} {
  const mias = ops.filter((o) => o.target === RUNTIME_OP_TARGET);
  const domOps = ops.filter((o) => o.target !== RUNTIME_OP_TARGET);
  if (mias.length === 0) return { domOps, runtime: { kind: "ninguna" } };
  if (mias.length > 1) return { domOps, runtime: { kind: "error", reason: "varias" } };

  const op = mias[0]!;
  // Sólo `replace`. Insertar "antes" o "después" de un blob de código no
  // significa nada, y `delete` tampoco se acepta todavía: borrar la cápsula
  // exige un tercer estado en `saveProjectData` (hoy un `runtime` falsy quiere
  // decir «no toques la columna», no «vacíala»). Queda anotado como hueco: HOY
  // NO HAY NINGUNA FORMA de quitarle el JavaScript a una página.
  if (op.type !== "replace") {
    return { domOps, runtime: { kind: "error", reason: "op_no_soportada" } };
  }
  const extraido = runtimeCodeFromOpPayload(op.newHtml ?? "");
  return {
    domOps,
    runtime: extraido.ok
      ? { kind: "codigo", code: extraido.code }
      : { kind: "error", reason: extraido.reason },
  };
}

/** Frase para el usuario cuando el script del turno se descartó. En español:
 *  la ve él, no el modelo. */
export function runtimeOpAviso(reason: RuntimeOpRejection): string {
  const porque: Record<RuntimeOpRejection, string> = {
    varias: "mandó dos versiones del código y no se puede saber cuál quería",
    op_no_soportada: "intentó insertar o borrar el código en vez de reemplazarlo",
    sintaxis: "el código que escribió no compila",
    vacio: "mandó el código vacío",
    demasiado_grande: "el código pasa del tamaño máximo",
    marcador_de_editor: "el código traía un marcador reservado del editor",
    ausente: `el script no llevaba el marcador \`${MODEL_RUNTIME_ATTR}\` que lo identifica`,
    varios: "mandó varios <script> dentro de la misma edición",
    con_src: "el script apuntaba a un fichero externo, y sólo se admite código en línea",
    modulo: "el script era un módulo, y sólo se admite un script clásico",
  };
  return `No pude aplicar el cambio de comportamiento: ${porque[reason]}. El resto de la edición sí se guardó, y la página sigue con el JavaScript que ya tenía.`;
}

/**
 * Vuelve a juntar el documento con su cápsula, al final del `<body>`.
 *
 * Al FINAL y no en el `<head>` porque el contrato que se le dio al modelo dice
 * que la página tiene que estar completa sin él: un script que corre antes de
 * que exista el DOM que va a tocar no mejora nada, falla.
 *
 * El marcador `data-openlen-model-runtime` NO viaja al documento resultante. En
 * el HTML servido no confiere autoridad a nadie —la autoridad la dio la cápsula
 * y la CSP la fija por hash— y dejarlo puesto sólo serviría para que alguien lo
 * copiara creyendo que significa algo.
 *
 * Sin `</body>` se pega al final. Un documento así ya pasó por el normalizador,
 * de modo que es un caso que no debería existir; perder el runtime en silencio
 * sería peor que ponerlo donde el navegador lo va a leer igual.
 *
 * VIVE AQUÍ y no en el publicador porque ya tiene tres llamadores: publicar
 * (`lib/publish/filesystem.ts`), los ojos del Agente (`lib/agent/verify.ts`) y
 * la medición del motor (`lib/page-engine/prepare.ts`). Las tres tenían que
 * injertar EXACTAMENTE igual —si los ojos miran un documento armado de otra
 * forma, miran una página que nadie recibe— y hasta ahora eran dos copias
 * escritas a mano.
 */
export function injectModelRuntime(html: string, code: string): string {
  const tag = `<script>${code}</script>`;
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}
