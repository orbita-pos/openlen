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

/** Lo que descalifica a la PÁGINA, no al script. Son las superficies con datos
 *  de un visitante: mientras el runtime no esté contenido, una página con
 *  formularios o módulos no entra en el piloto. Se comprueba sobre el HTML ya
 *  canónico, y se vuelve a comprobar al publicar. */
export function pageAllowsRuntime(html: string): boolean {
  if (/<form[\s>]/i.test(html)) return false;
  if (/data-ol-(bookings|collection|members|orders|chat|comments)-section/i.test(html)) return false;
  return true;
}

/** Opt-in EXACTO. Ni "true", ni "yes", ni vacío: sólo "1". Una variable de
 *  entorno mal escrita no puede encender esto por accidente. */
export function modelJsEnabled(env: NodeJS.ProcessEnv): boolean {
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
 * Se le dice que el DOM debe funcionar sin el script, y no por cortesía: el
 * runtime puede rechazarse aquí por diez motivos distintos, y una página cuya
 * información sólo existe si el JavaScript corre sería una página vacía.
 */
export function modelRuntimePromptBlock(env: NodeJS.ProcessEnv): string {
  if (!modelJsEnabled(env)) return "";
  return `

INTERACCIÓN CON JAVASCRIPT (opcional — sólo si esta página gana algo real con ella):
Puedes incluir UN único bloque, el último del body, exactamente así:
<script ${MODEL_RUNTIME_ATTR}>
  // JavaScript clásico. Sin src, sin type="module", sin import, sin fetch a otros dominios.
</script>
Reglas que se comprueban y que, si se incumplen, descartan el bloque entero:
- Uno solo, inline, y nada de \`src\` ni \`type="module"\`.
- Máximo ${Math.floor(MAX_RUNTIME_BYTES / 1024)} KiB.
- La página tiene que estar COMPLETA y legible sin él: el script mejora, nunca construye el contenido.
- Sin red: ni fetch, ni XMLHttpRequest, ni WebSocket, ni Worker. La política de la página los bloquea.
- No lo uses para formularios ni para nada que envíe datos de un visitante.
Si la página no gana nada con interacción, no incluyas el bloque.`;
}
