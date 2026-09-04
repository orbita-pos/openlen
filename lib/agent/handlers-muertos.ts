// lib/agent/handlers-muertos.ts — un botón que nace MUDO y no se queja.
//
// EL FALLO. El saneador borra TODO atributo `on*` en cada ingestión. El prompt
// lo avisa desde hace meses («los atributos on* se borran al guardar, así que un
// botón cableado así queda mudo aunque el script sobreviva entero») y hasta hoy
// eso era lo ÚNICO que lo evitaba: una frase pidiéndolo por favor. No había un
// solo detector — comprobado el 2026-09-03.
//
// Y es el fallo silencioso perfecto, que es lo que lo hace caro:
//   · el guardado no falla,
//   · la captura sale impecable — el botón está ahí, con su texto y su color,
//   · la consola sale LIMPIA: no hay error, es que no hay manejador,
//   · el crítico con visión lo aprueba,
//   · y el dueño lo descubre cuando un cliente le dice que no pasa nada.
//
// Ver [[model-js-two-blind-spots]]: «on* se borra (consola limpia)» estaba
// apuntado como punto ciego SIN ARREGLAR. Esto es su mitad.
//
// SE MIDE SOBRE LO QUE EL MODELO MANDÓ, nunca sobre el documento guardado —
// para cuando se guarda, el saneador ya se los llevó y no queda rastro. Por eso
// vive aquí y no en el embudo de escritura.
//
// PURO: una cadena a una lista.

/** Un manejador que se va a borrar al guardar. */
export interface HandlerMuerto {
  /** El atributo tal cual lo escribió el modelo: `onclick`, `onsubmit`… */
  readonly atributo: string;
  /** Un trozo de la etiqueta donde estaba, para que sepa cuál es. */
  readonly donde: string;
}

const MAX_NOMBRADOS = 4;

/**
 * Los eventos que se buscan, EN LISTA CERRADA y no con un `on\w+` genérico.
 *
 * Un `on[a-z]+=` suelto casa con `once="true"` o con un atributo propio que
 * empiece por «on», y un aviso que salta sobre algo correcto enseña —al modelo
 * y al dueño— a ignorar el aviso. Prefiero que se me escape un evento raro a
 * llorar al lobo: lo primero se arregla añadiendo una palabra a esta lista.
 */
const EVENTOS = [
  "click", "dblclick", "contextmenu", "mousedown", "mouseup", "mouseover", "mouseout",
  "mousemove", "mouseenter", "mouseleave", "wheel",
  "keydown", "keyup", "keypress",
  "submit", "reset", "change", "input", "invalid", "select",
  "focus", "blur", "focusin", "focusout",
  "load", "error", "unload", "beforeunload", "scroll", "resize",
  "touchstart", "touchend", "touchmove", "touchcancel",
  "pointerdown", "pointerup", "pointermove",
  "drag", "dragstart", "dragend", "dragover", "dragenter", "dragleave", "drop",
  "play", "pause", "ended", "timeupdate", "volumechange",
  "toggle", "animationend", "animationstart", "transitionend",
  "copy", "cut", "paste",
];

const HANDLER_RE = new RegExp(`\\son(${EVENTOS.join("|")})\\s*=`, "gi");
/** Los `<script>` enteros: dentro, `el.onclick = fn` es JavaScript legítimo y
 *  SOBREVIVE. Sólo se borran los ATRIBUTOS del marcado. */
const SCRIPT_RE = /<script\b[\s\S]*?<\/script>/gi;
const COMENTARIO_RE = /<!--[\s\S]*?-->/g;

/** ¿Este nombre de atributo es un manejador de los que se borran? */
export function esHandler(nombre: string): boolean {
  const n = nombre.trim().toLowerCase();
  return n.startsWith("on") && EVENTOS.includes(n.slice(2));
}

/** Los manejadores en línea que el guardado va a borrar. */
export function handlersMuertos(html: string): HandlerMuerto[] {
  // Los scripts y los comentarios se ciegan ANTES de buscar, conservando el
  // largo para que los índices sigan valiendo.
  const limpio = html
    .replace(SCRIPT_RE, (m) => " ".repeat(m.length))
    .replace(COMENTARIO_RE, (m) => " ".repeat(m.length));

  const salida: HandlerMuerto[] = [];
  for (const m of limpio.matchAll(HANDLER_RE)) {
    const i = m.index ?? 0;
    // El principio de la etiqueta, para poder nombrarla.
    const abre = html.lastIndexOf("<", i);
    const donde = html.slice(abre >= 0 ? abre : i, i + 40).replace(/\s+/g, " ").trim();
    salida.push({ atributo: `on${m[1]!.toLowerCase()}`, donde: donde.slice(0, 60) });
  }
  return salida;
}

/**
 * El aviso PARA EL MODELO, en el mismo turno.
 *
 * Le dice las tres cosas que necesita: qué se va a borrar, POR QUÉ no se va a
 * enterar por otra vía, y con qué se sustituye. Lo tercero importa: sin el
 * camino, un aviso sólo es una queja.
 */
export function avisoHandlersMuertos(lista: readonly HandlerMuerto[]): string {
  const nombrados = lista
    .slice(0, MAX_NOMBRADOS)
    .map((h) => `${h.atributo} en \`${h.donde}\``)
    .join(" · ");
  const resto = lista.length > MAX_NOMBRADOS ? ` (y ${lista.length - MAX_NOMBRADOS} más)` : "";
  return (
    `Has cableado ${lista.length} manejador(es) EN LÍNEA y el guardado los BORRA: ${nombrados}${resto}. ` +
    `El botón se queda en la página con su texto y su color, y no hace absolutamente nada — sin error ` +
    `en consola, porque no hay código que falle: es que no hay manejador. Ni la captura ni la revisión ` +
    `pueden verlo. Recablealo AHORA, en este mismo turno: quita el atributo con op="attrs" y ` +
    `value:null, y engancha el evento con addEventListener DENTRO del script, con ` +
    `editar_runtime. Y manda \`prueba\`, que es lo único que comprueba de verdad que ` +
    `el botón responde.`
  );
}
