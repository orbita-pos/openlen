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

  const code = el.rawText;
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
