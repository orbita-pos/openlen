import vm from "node:vm";
import { parse, type HTMLElement } from "node-html-parser";
import type { Op } from "@/lib/html-ops";

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
    // CUALQUIER `<script>`, no sólo el marcado. El atributo existía para poder
    // distinguir el script del modelo del resto del documento cuando había que
    // EXTRAERLO; aquí el payload ES el script, no hay nada de lo que
    // distinguirlo, y desde el 2026-08-26 el prompt ya no se lo pide. Exigirlo
    // rechazaba con «ausente» un `<script>` perfectamente válido.
    lista = parse(rawHtml).querySelectorAll("script");
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
  _env: Readonly<Record<string, string | undefined>>,
): string {
  // SIN INTERRUPTOR y SIN ATRIBUTO ESPECIAL. El `data-openlen-model-runtime`
  // existía para poder EXTRAER el script del texto crudo y guardarlo en su
  // columna; desde el 2026-08-26 no se extrae nada, así que pedirle una marca
  // al modelo sería pedirle que firme algo que nadie lee. Escribe `<script>`,
  // como en cualquier página.
  return `

INTERACCIÓN CON JAVASCRIPT
Puedes escribir el JavaScript de esta página, en un <script> normal al final del body.
Úsalo para lo que el CSS no alcanza: filtrar una lista, una galería con lightbox, pestañas, un carrito, un cronómetro, un juego.
La página tiene que estar COMPLETA y legible sin el script: el JavaScript mejora, nunca construye el contenido.
NUNCA escondas contenido con CSS para revelarlo desde el script: si el script no corre, ese contenido no existe — ni para quien lo lee ni para Google.`;
}
/** Cómo se le pide al modelo que envuelva un cambio de comportamiento.
 *  Se conserva porque los builders de prompt siguen tipando con él. */
export type RuntimeEditEnvelope = "xml" | "tool" | "documento";

/**
 * RETIRADO el 2026-08-26. Devolvía «éste es el código que tu página ya tiene»
 * en un bloque APARTE, porque `data.html` se guardaba saneado y el documento
 * que viajaba al modelo NO llevaba su script. Consecuencia medida: al pedirle
 * «arregla el bug del juego», el modelo no reparaba — RE-CREABA la
 * funcionalidad desde cero, y nadie lo notaba porque el resultado funciona.
 *
 * Ahora el script viaja DENTRO del documento, así que el modelo lo ve donde
 * está. Se conserva la firma para no romper a los llamadores; devuelve vacío.
 */
export function currentRuntimePromptBlock(
  _code: string,
  _envelope: RuntimeEditEnvelope = "xml",
): string {
  return "";
}
export const RUNTIME_OP_TARGET = "runtime";

export type RuntimeOpRejection =
  | RuntimeRejection
  /** Más de una op contra el runtime: no se fusionan (mismo criterio que
   *  `extractModelRuntime` con dos `<script>`) — no sabríamos en qué orden. */
  | "varias"
  /** `insert_before` / `insert_after` sobre un blob de código. */
  | "op_no_soportada";

export type RuntimeOpResult =
  | { readonly kind: "ninguna" }
  | { readonly kind: "codigo"; readonly code: string }
  /** `delete` sobre el runtime: QUITARLE el JavaScript a la página. */
  | { readonly kind: "borrar" }
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
  // `delete` BORRA la cápsula. Hasta el 2026-08-25 no se aceptaba y el hueco
  // estaba anotado aquí mismo: «HOY NO HAY NINGUNA FORMA de quitarle el
  // JavaScript a una página». Se cerró dándole a `persistPage` el tercer estado
  // que faltaba (`RuntimeIntent`), porque un `runtime` falsy quería decir «no
  // toques la columna» y no había forma de decir «vacíala». Sin eso, «quítame
  // el carrito» o «déjala sin animaciones» eran imposibles: un `replace` vacío
  // se rechaza y la ausencia de runtime RE-SELLA el código anterior sobre el
  // documento nuevo.
  if (op.type === "delete") return { domOps, runtime: { kind: "borrar" } };
  // Insertar "antes" o "después" de un blob de código no significa nada.
  if (op.type !== "replace") {
    return { domOps, runtime: { kind: "error", reason: "op_no_soportada" } };
  }
  // Un `replace` VACÍO sigue siendo un error, no un borrado: es muchísimo más
  // probable que sea una respuesta truncada que una intención de quitarlo.
  // Borrar exige decirlo (`op="delete"`).
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
    op_no_soportada: "intentó insertar el código en vez de reemplazarlo o borrarlo",
    sintaxis: "el código que escribió no compila",
    vacio: "mandó el código vacío (para quitarlo hay que borrarlo, no vaciarlo)",
    demasiado_grande: "el código pasa del tamaño máximo",
    marcador_de_editor: "el código traía un marcador reservado del editor",
    ausente: "no venía ningún <script> en el cambio",
    varios: "mandó varios <script> dentro de la misma edición",
    con_src: "el script apuntaba a un fichero externo, y sólo se admite código en línea",
    modulo: "el script era un módulo, y sólo se admite un script clásico",
  };
  return `No pude aplicar el cambio de comportamiento: ${porque[reason]}. El resto de la edición sí se guardó, y la página sigue con el JavaScript que ya tenía.`;
}

// `injectModelRuntime` se MUDÓ a ./inject-model-runtime, que no importa nada de
// Node: el taller (un componente de cliente) necesita injertar EXACTAMENTE
// igual que el publicador, y este módulo arrastra `node:vm` al bundle. Se
// re-exporta para que los llamadores de servidor no cambien de import — y sobre
// todo para que siga habiendo UNA sola implementación: si el editor injertara
// de otra forma, enseñaría una página que nadie recibe.
export { injectModelRuntime } from "./inject-model-runtime";
