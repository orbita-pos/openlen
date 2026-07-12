import { beforeEach, afterEach } from "vitest";
import { buildBehaviorsScript } from "../build";

/** Monta un body y ejecuta el runtime compuesto sobre él, tal como llegaría
 *  al navegador — salvo por `new Function`, que SOLO existe aquí: el runtime
 *  real nunca evalúa una string, la etiqueta <script> la ejecuta el navegador. */
export function mount(body: string) {
  document.body.innerHTML = body;
  const script = buildBehaviorsScript(`<html><body>${body}</body></html>`)!;
  // eslint-disable-next-line no-new-func
  new Function(script)();
}

/**
 * Por qué existe esto: cualquier receta cuyo runtime delega en un solo
 * listener puesto sobre `document` (patrón común — un handler por documento
 * en vez de uno por elemento, como hace `lightbox` con click) fuga un
 * listener por cada `mount()`. Vitest/jsdom reutilizan el MISMO `document`
 * para todos los `it()` de un archivo; un `beforeEach` que solo resetea
 * `body.innerHTML` no toca los listeners ya puestos sobre `document`, así que
 * se acumulan uno encima de otro conforme corren los tests.
 *
 * La trampa: en una receta IDEMPOTENTE (togglear el mismo atributo un número
 * par o impar de veces deja el mismo estado observable) esta fuga pasa en
 * VERDE — N handlers acumulados hacen la misma mutación N veces, nadie lo
 * nota. Solo se manifiesta como fallo cuando una receta CREA algo nuevo cada
 * vez que dispara: `lightbox` lo cazó porque abrir el modal dos veces (un
 * click, N handlers vivos) crea N modales, y un test que cierra clickeando
 * UNO deja vivos los N-1 restantes. Las próximas recetas de este catálogo
 * (filter incluida) usan el mismo patrón de click delegado — sin este
 * tracking, su fuga sería invisible en CI hasta el día que alguien escriba un
 * test que sí la note, y para entonces ya se le habrá olvidado el porqué.
 *
 * Llama a esta función UNA VEZ dentro de tu `describe(...)`: engancha el
 * tracking a beforeEach/afterEach de ESE bloque, así que cubre todos sus
 * `it()`. En una página publicada esto no pasa nunca — bakeBehaviors es
 * idempotente vía BEHAVIORS_MARKER, un único <script> por página; es higiene
 * de los tests, no del runtime.
 */
export function trackDocumentListeners() {
  let tracked: Array<[string, EventListenerOrEventListenerObject]>;
  let origAddEventListener: typeof document.addEventListener;

  beforeEach(() => {
    tracked = [];
    origAddEventListener = document.addEventListener.bind(document);
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ) => {
      tracked.push([type, listener]);
      origAddEventListener(type, listener, opts);
    }) as typeof document.addEventListener;
  });

  afterEach(() => {
    document.addEventListener = origAddEventListener;
    for (const [type, listener] of tracked) document.removeEventListener(type, listener);
  });
}
