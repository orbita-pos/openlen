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

/**
 * GOTCHA HERMANO del de arriba (la fuga de listeners): en jsdom, `el.click()`
 * y `el.dispatchEvent(...)` siguen el spec DOM al pie de la letra —
 * "reportar la excepción" (report the exception), NO relanzarla al llamador.
 * Si el listener real explota, jsdom la manda al stderr (se ve en
 * lightbox.test.ts como "Not implemented: window.alert" sin que ESE test
 * falle) y el `.click()` que la disparó retorna con total normalidad, como si
 * nada hubiera pasado.
 *
 * Consecuencia práctica: `expect(() => btn.click()).not.toThrow()` PASA EN
 * VERDE tanto si el runtime envuelve su lógica en try/catch como si NO lo
 * hace — el try/catch nunca se pone a prueba, porque la excepción jamás
 * llega a la pila de llamadas del test. Es un assert con forma de prueba que
 * no prueba nada; borra el guard que dice proteger y se queda en verde igual.
 *
 * La técnica correcta: capturar la referencia REAL del listener que `mount()`
 * registró — vía `vi.spyOn(document, "addEventListener")`, ANTES de montar —
 * e invocarla como función PLANA, no a través de dispatchEvent/.click(). Una
 * llamada directa SÍ propaga la excepción al call site del test, así que
 * `expect(() => handler(evento)).not.toThrow()` vuelve a significar algo:
 *
 *   const addSpy = vi.spyOn(document, "addEventListener");
 *   mount(MARKUP);
 *   const call = addSpy.mock.calls.find(([type]) => type === "click")!;
 *   const handler = call[1] as unknown as (e: { target: EventTarget | null }) => void;
 *   addSpy.mockRestore();
 *   expect(() => handler({ target: btn })).not.toThrow();
 *
 * Ver theme.test.ts ("localStorage que lanza…") para el caso real que forzó
 * a documentar esto: ahí, borrar el try/catch de la receta deja ese test en
 * VERDE igual si se prueba con `.click()` — solo se pone rojo invocando el
 * listener así. Deliberadamente no hay un helper compartido para esto (un
 * solo caller hoy); si una segunda receta lo necesita, ese es el momento de
 * extraerlo, no antes.
 */
