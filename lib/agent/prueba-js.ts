// LA PRUEBA DECLARADA, EN JAVASCRIPT — la opción A, con la forma de CodeMode.
//
// Desde el 2026-09-22 es la ÚNICA forma: el DSL de pasos en JSON (la opción B,
// `behavior-spec.ts`) se retiró, y con él se mudó aquí lo que la ejecución
// sigue necesitando —la ventana, el censo, leer lo que devuelve el navegador y
// la nota de sus fallos—. De la forma vieja sólo queda su migración, en
// `pruebas-de-la-pagina.ts`.
//
// 🔴 POR QUÉ EXISTE, y por qué NO es «forma libre».
//
// Jesús, 2026-09-04: «lo que estamos haciendo es parchear parchear y parchear»,
// y la queja concreta era que le hacemos la vida más difícil al modelo con un
// mini-lenguaje JSON inventado por nosotros. Tenía razón en el diagnóstico: de
// las 11 pruebas que el modelo declaró en una corrida de 16 páginas, 4 se
// tiraron por la puerta de entrada — y 2 de ellas por una regla de sintaxis que
// el prompt ni siquiera enunciaba bien.
//
// Se investigó qué hacen de verdad las herramientas grandes:
//
//   · **OpenCode** (`D:/opencode/packages/codemode`) — su modo «el modelo
//     escribe JS» existe, y su contrato es: *«a small JavaScript program that
//     can call ONLY the tools supplied by the host»*, con Effect Schema
//     validando cada primitivo, intérprete confinado, `maxToolCalls` y
//     `timeoutMs`. Y está detrás de `flags.experimentalCodeMode` — NO es el
//     defecto.
//   · **Kiro** (AWS) va MÁS acotado que nosotros: el modelo escribe requisitos
//     en EARS, una sintaxis restringida elegida «para eliminar la ambigüedad
//     que hace difícil automatizar», y las pruebas las GENERA la máquina.
//   · **Claude Code** no tiene prueba declarada: verifica con herramientas
//     tipadas y su `Edit` falla si el ancla no casa EXACTAMENTE una vez. Su JS
//     libre en la página está acotado por escrito a «depuración e inspección».
//
// Conclusión, y es la que da forma a este fichero: **nadie acepta forma libre.
// Lo que hacen es dejar que el modelo escriba el PEGAMENTO y acotar los
// PRIMITIVOS.** Así que aquí el modelo escribe JavaScript de verdad —secuencia,
// condiciones, variables— y nosotros ponemos un `ui` cuyos verbos llevan dentro
// las tres lecciones que costaron corridas pagadas:
//
//   1. LA VENTANA DE ESPERA de 1,5 s. Sin ella, el 100% de las promesas con
//      tiempo dentro fallan (medido el 2026-08-23 sobre un pomodoro correcto:
//      se comprobaba a los 0 ms y el reloj aún marcaba 25:00). En JSON vivía en
//      el motor; aquí vive DENTRO de cada aserción, así que el modelo no tiene
//      que acordarse.
//   2. EL CONTEO DEL SELECTOR — `querySelectorAll(sel).length === 1`, la regla
//      del `Edit` de Claude Code. Un selector que no señala a uno es fallo DE
//      LA PRUEBA y no acusa a la página.
//   3. EL GUARDIA DE NAVEGACIÓN, con su excepción: un clic sobre un botón de
//      envío NO se cancela, porque su acción por defecto es disparar el
//      `submit` donde el modelo engancha su manejador.
//
// Y una cuarta que el JSON no podía dar: `cambiaDe(sel, antes)` es explícito.
// En JSON el motor tenía que fotografiar el «antes» por su cuenta y adivinar
// cuándo; en JavaScript lo captura el modelo, que es quien sabe cuándo importa.

/** Techo del programa del modelo. Seis pasos con selectores caben de sobra; más
 *  que esto es una suite dentro de una edición. */
export const MAX_PRUEBA_JS_BYTES = 4 * 1024;

/** Techo de PARED del programa entero, dentro del navegador. Un `while(true)`
 *  del modelo no puede colgar la medición: a partir de aquí se corta y se
 *  reporta como fallo DE LA PRUEBA. Seis pasos a 1,5 s de ventana son 9 s en el
 *  peor caso; 20 s deja margen sin dejar que un bucle se coma la corrida. */
export const TECHO_PRUEBA_JS_MS = 20_000;

/** Número máximo de llamadas a `ui.*`. El equivalente del `maxToolCalls` de
 *  CodeMode: acota sin tener que entender el programa. */
export const MAX_LLAMADAS_UI = 40;

/**
 * CUÁNTO SE ESPERA a que la promesa se cumpla, por afirmación.
 *
 * 🔴 EL FALLO QUE ESTO ARREGLA, medido el 2026-08-23 sobre una página que
 * DeepSeek acababa de escribir: un pomodoro correcto, con `setInterval(…, 1000)`
 * y consola limpia. Su propia prueba —«pulsa #startBtn, el reloj cambia»— es
 * exactamente la que escribiría cualquiera. Fallaba SIEMPRE, porque se
 * comprobaba a los 0 ms y el reloj todavía marcaba 25:00. Con el navegador
 * delante: al instante 25:00, al segundo 24:59, cero gritos.
 *
 * Sin ventana, TODA promesa con tiempo dentro es infalseable: una cuenta atrás,
 * un carrusel que avanza solo, una búsqueda con retardo, un revelado por
 * transición. Y no es teórico — falla en el 100% de los casos, no en algunos.
 *
 * 1,5 s cubre el intervalo de un segundo con margen. Sólo lo paga la
 * afirmación que FALLA: en cuanto se cumple, el programa sigue (ver `hasta`).
 */
export const VENTANA_PRUEBA_MS = 1_500;

/**
 * Cuánto se guarda de un mensaje que llega DEL NAVEGADOR. Acotar hace falta —la
 * cadena la compone el programa y no queremos una página metiendo un megabyte
 * en el turno— pero el tope no puede ser tan corto que MUTILE lo que el mensaje
 * nombra.
 *
 * 🔴 ERA 200, Y MENTÍA. Un mensaje que cita el selector dos veces —el del clic
 * sin manejador lo pone en el hecho y en el arreglo, `ui.desplaza("…")`— no
 * cabía: lo que se perdía era la cola, que es donde va el arreglo. Recortar el
 * selector DENTRO del arreglo es peor todavía —le da al modelo un selector que
 * no existe—, y un mensaje que miente es peor que uno largo: es la doctrina de
 * degradación.
 *
 * Con 400 el arreglo llega entero con selectores de hasta ~160 caracteres, y
 * sigue acotado; lo que se recorta antes es la nota final, que va detrás a
 * propósito. La TARJETA no depende de esto: la acota aparte `TOPE_MOTIVO`, en
 * `motivo-del-fallo.ts`.
 */
export const TOPE_MENSAJE = 400;

/** Lo que un paso falló, en la lengua del usuario — la lee él, y también el
 *  modelo, que necesita saber QUÉ elemento y QUÉ se esperaba. El «paso» es la
 *  llamada a `ui.*` en la que el programa se paró, contada desde 1. */
export interface FalloSpec {
  readonly paso: number;
  readonly mensaje: string;
  /** `true` cuando lo que falla es LA PRUEBA, no la página: un selector que no
   *  señala a nada o que señala a varios, un programa que no compila. No acusa
   *  al documento y no puede disparar una reparación — «una prueba que no se
   *  pudo correr no acusa a nadie», la misma regla fail-soft que rige la
   *  entrada mal formada. */
  readonly deLaPrueba?: boolean;
  /** De QUÉ promesa es, cuando el programa corre varias (`programaSuiteJs`):
   *  0 es la primera. Es lo que deja repartir sin cortar por número de paso. */
  readonly programa?: number;
}

/**
 * EL CENSO DE MANEJADORES DE CLIC — se instala ANTES de que la página cargue.
 *
 * 🔴 POR QUÉ EXISTE. La primera prueba declarada —el DSL de pasos, retirado el
 * 2026-09-22— no comprobaba causalidad: tomaba una foto, actuaba, y daba por
 * cumplida la promesa si algo se movía dentro de la ventana, sin mirar QUIÉN lo
 * movió. MEDIDO en Chromium con brazo de control: un clic sobre un botón MUERTO
 * cumplía la promesa si un contador se animaba solo, y el mismo botón sin
 * animación fallaba. O sea, el clic era decorativo y la prueba pasaba sin
 * probar nada. Un programa JS tiene el mismo hueco, y por eso `ui.clic` mira
 * el censo antes de pulsar.
 *
 * LA FORMA DEL ARREGLO NO ES MEDIR DOS VECES, es que la acción falle antes. Es
 * lo que hace Claude Code, provocado en su propio arnés: un `Edit` con
 * `old_string === new_string` devuelve «No changes to make: old_string and
 * new_string are exactly the same» y no toca el fichero; y su contrato le dice
 * al modelo que no relea lo que acaba de editar para comprobarlo, porque si el
 * cambio hubiera fallado la edición habría dado error. La acción reporta su
 * propio efecto.
 *
 * ⚠️ VA COMO CADENA, no como función: `evaluateOnNewDocument(() => …)` pasa por
 * esbuild/tsx, que inyecta el ayudante `__name`, y ése no existe dentro del
 * navegador. Ya costó una sesión ([[render-measured-contrast]]).
 *
 * ⚠️ Y EXIGE NAVEGACIÓN DE VERDAD. Con `page.setContent` —que usa
 * `document.write`— no hay documento nuevo y esto NO se instala: el censo
 * saldría a cero para todo y acusaría a cualquier botón. Por eso el consumidor
 * carga con `cargarEnOrigenReal`, y por eso el programa es FAIL-OPEN cuando el
 * registro no está: no medir no es medir mal.
 */
export const PRELUDIO_CENSO_CLIC = `
(function () {
  // Sólo los registros de la PÁGINA: esto corre antes que sus scripts y mucho
  // antes que los guardias del programa, que se instalan después del censo.
  var conClic = new Set();
  var orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (tipo, fn, opciones) {
    if (tipo === "click") conClic.add(this);
    return orig.call(this, tipo, fn, opciones);
  };
  window.__olCensoClic = conClic;
})();
`;

/**
 * ¿Esto es un programa JS, o la lista de pasos del DSL retirado?
 *
 * Se decide por la FORMA del contenido: uno que empieza por `[` o `{` es el
 * JSON del DSL, que desde el 2026-09-22 se rechaza con su nombre
 * (`prueba_retirada`) en vez de convertirse; cualquier otra cosa se trata como
 * JS.
 */
export function pareceJs(bruto: string): boolean {
  const t = bruto.trim();
  if (!t) return false;
  return !(t.startsWith("[") || t.startsWith("{"));
}

/** La promesa que el modelo declaró, ya validada: el programa sobre `ui.*`.
 *  Es lo que viaja hasta el motor de página (`PreparePageOptions.prueba`). */
export interface PruebaDeclarada {
  readonly codigo: string;
}

export type PruebaJsRechazo = "vacia" | "demasiado_grande";

export type PruebaJsExtraction =
  | { readonly ok: true; readonly codigo: string }
  | { readonly ok: false; readonly reason: PruebaJsRechazo };

/**
 * La única validación de ENTRADA que queda, y es a propósito.
 *
 * No se comprueba la sintaxis aquí: un `new Function(codigo)` en el servidor
 * mediría OTRO parser que el del navegador que lo va a correr, y ya nos mordió
 * una vez deducir en el servidor lo que el navegador podía contestar. Un
 * programa que no compila lo dice Chromium, y se reporta como fallo DE LA
 * PRUEBA — no de la página.
 */
export function validaPruebaJs(bruto: string): PruebaJsExtraction {
  const codigo = bruto.trim();
  if (!codigo) return { ok: false, reason: "vacia" };
  if (new TextEncoder().encode(codigo).length > MAX_PRUEBA_JS_BYTES) {
    return { ok: false, reason: "demasiado_grande" };
  }
  return { ok: true, codigo };
}

/**
 * El programa que corre DENTRO del navegador, con el código del modelo dentro.
 *
 * ⚠️ VA COMO CADENA, nunca como función: `page.evaluate(() => …)` pasa por
 * esbuild/tsx, que inyecta el ayudante `__name`, que no existe en el
 * navegador. Ya costó una sesión entera.
 *
 * 🔴 EL CÓDIGO DEL MODELO VIAJA COMO CADENA Y SE COMPILA AQUÍ DENTRO, con
 * `new Function`. Incrustarlo tal cual parecía más simple y tiene un agujero
 * que su propia prueba destapó: **un error de sintaxis del modelo no se puede
 * cazar desde dentro del mismo script** — el `try` no llega ni a existir, el
 * `page.evaluate` entero revienta y la medición se pierde con un error que no
 * habla de la página. Compilándolo se convierte en un fallo normal, y además
 * el programa sólo recibe `ui` por parámetro, que es la forma de CodeMode:
 * «a program that can call only the tools supplied by the host».
 */
export function programaJs(
  codigo: string,
  opciones: {
    /** ¿Es la promesa DE ESTE TURNO (`true`, el defecto) o una GUARDADA? Decide
     *  de quién es un clic muerto: en la del turno el modelo acaba de escribir
     *  la prueba, así que es fallo de la PRUEBA; en una guardada, que se
     *  cumplió el día que se guardó, el que cambió es la PÁGINA — la regresión. */
    readonly propia?: boolean;
  } = {},
): string {
  return programaSuiteJs([{ codigo, propia: opciones.propia !== false }]);
}

/**
 * EL BRAZO SIN ACCIONES: la misma promesa, con sus acciones anuladas.
 *
 * 🔴 POR QUÉ EXISTE (2026-09-22). Una afirmación que ya se cumplía antes de
 * actuar —un contador que llega solo a «5,000», un panel que ya estaba
 * visible— deja la promesa en verde sin decir nada de la acción. Lo detectaba
 * sólo el DSL, porque conocía sus expectativas de antemano; un programa JS no
 * las enseña hasta que corre.
 *
 * La forma es la de un eval con brazo de control: se corre lo MISMO sin el
 * sujeto y se compara. Lo que se cumple en los dos brazos no discrimina, y una
 * promesa sin acciones tiene los dos brazos idénticos —comparar no mide nada—.
 * Es una medida de la BATERÍA, no del turno del usuario: cuesta otra carga de
 * la página, y no acusa a nadie. Lo que devuelve lo lee `leerVacuas`.
 *
 * Sin censo a propósito: con las acciones anuladas no hay clic que censar.
 */
export function programaSinAccionesJs(codigo: string): string {
  return programaSuiteJs([{ codigo, propia: true, sinAcciones: true }]);
}

/** Una promesa dentro de un programa: su código y de quién es. */
export interface EntradaDePrograma {
  readonly codigo: string;
  /** `true` = la del turno; `false` = una guardada. Ver `programaJs`. */
  readonly propia: boolean;
  /** El BRAZO SIN ACCIONES: las acciones no se hacen y las afirmaciones no
   *  cortan. Sólo lo pide la batería — ver `programaSinAccionesJs`. */
  readonly sinAcciones?: boolean;
}

/**
 * VARIAS PROMESAS EN UNA SOLA PASADA: la del turno y detrás las guardadas.
 *
 * Cada fallo vuelve con el ÍNDICE DE SU PROGRAMA como cuarto elemento, y eso es
 * lo que deja repartirlo (`repartirFallos`). El DSL repartía cortando por
 * número de paso, y un programa JS no tiene pasos fijos: sus números son las
 * llamadas a `ui.*`, que dependen de lo que el código haga.
 *
 * 🔴 EL TECHO DE PARED ES DEL CONJUNTO, no de cada una: ocho guardadas con el
 * suyo cada una podrían tardar minutos. Y a una GUARDADA que se queda sin
 * tiempo no se la trata como fallo de la prueba —eso la RETIRARÍA de la suite—
 * sino como SIN CORRER: ni se comprobó ni se toca. No medir no es medir mal.
 */
export function programaSuiteJs(entradas: readonly EntradaDePrograma[]): string {
  const programas = entradas.map((e) => ({
    codigo: e.codigo,
    propia: e.propia,
    ...(e.sinAcciones ? { sinAcciones: true } : {}),
  }));
  return `
(async () => {
  var PROGRAMAS = ${JSON.stringify(programas)};
  var PROPIA = true;      // la de la promesa que está corriendo ahora
  var VENTANA = ${VENTANA_PRUEBA_MS};
  var TECHO = ${TECHO_PRUEBA_JS_MS};
  var MAX_LLAMADAS = ${MAX_LLAMADAS_UI};
  var fallos = [];
  var n = 0;              // qué llamada a ui.* vamos: es el "paso" del mensaje
  var llamadas = 0;
  var finPared = Date.now() + TECHO;
  var SIN_ACCIONES = false; // el brazo de control: ver \`afirmar\`
  var ACTUAL = 0;           // qué programa corre (la \`k\` del bucle, que \`clic\` tapa)
  var acciones = 0;         // cuántas acciones pidió el programa, se hicieran o no
  var vacuasDe = [];

  // EL REGISTRO DEL CENSO, leído ANTES del guardia de abajo. El guardia es un
  // listener de clic en \`document\`, y con el censo puesto marcaría vivo a
  // cualquier botón de la página (medido en el DSL: censo 0 antes, 1 después).
  var REGISTRO = (typeof window !== "undefined" && window.__olCensoClic) || null;
  var documentoYaTenia = REGISTRO ? REGISTRO.has(document) : false;

  // EL GUARDIA, con su excepción, que se midió en el DSL: cancelar
  // la acción por defecto de un clic sobre \`type="submit"\` impide que se
  // dispare el \`submit\` del formulario, que es donde el modelo engancha su
  // manejador — y la prueba acusaba a páginas correctas.
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("button,input") : null;
    if (t && t.form && t.type === "submit") return;
    e.preventDefault();
  }, true);
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);
  if (REGISTRO && !documentoYaTenia) REGISTRO.delete(document);

  function Alto(mensaje, deLaPrueba) {
    var err = new Error(mensaje);
    err.__ol = true;
    err.__mensaje = mensaje;
    err.__deLaPrueba = !!deLaPrueba;
    return err;
  }

  function presupuesto() {
    if (++llamadas > MAX_LLAMADAS) throw Alto("tu prueba pasa de " + MAX_LLAMADAS + " acciones", true);
    if (Date.now() > finPared) {
      var agotado = Alto("tu prueba tardó más de " + (TECHO / 1000) + "s", true);
      agotado.__tiempo = true;
      throw agotado;
    }
  }

  // EXACTAMENTE UNO, contado aquí y no adivinado con una regex en el servidor.
  function uno(sel) {
    var els;
    try { els = document.querySelectorAll(sel); }
    catch (e) { throw Alto("el selector " + sel + " no es CSS válido", true); }
    if (els.length === 0) throw Alto("no existe " + sel, true);
    if (els.length > 1) throw Alto(sel + " señala " + els.length + " elementos, no uno", true);
    return els[0];
  }

  // DONDE SE ACTÚA, con las DOS salidas de un objetivo ambiguo: afinar, o
  // DECLARAR que da igual cuál. Es la forma de \`replace_all\`: un parámetro
  // explícito, nunca adivinar. Los botones creados con \`createElement\` no
  // tienen id —era la clase de rechazo que más fallaba—, y \`{ cualquiera: true }\`
  // pulsa el primero VISIBLE del grupo.
  // POR SU TEXTO, cuando el botón no tiene id: se busca entre lo pulsable igual
  // que lo haría una persona, y vale para lo que sólo existe tras correr el
  // código de la página. Entre varios que casan, el único que SE VE; si no hay
  // uno solo, no se adivina.
  var PULSABLES = 'button, [role="button"], a, summary, input[type="button"], input[type="submit"], [onclick]';
  function nombreDe(el) {
    var n = el.getAttribute("aria-label") || el.value || el.textContent || el.title || "";
    return String(n).replace(/\\s+/g, " ").trim().toLowerCase();
  }
  function porNombre(q) {
    var busca = String(q).replace(/\\s+/g, " ").trim().toLowerCase();
    if (!busca) throw Alto("no hay nada que buscar", true);
    var todos = Array.prototype.slice.call(document.querySelectorAll(PULSABLES));
    var casan = todos.filter(function (el) { return nombreDe(el).indexOf(busca) !== -1; });
    if (casan.length > 1) {
      var visibles = casan.filter(seVe);
      if (visibles.length === 1) return visibles[0];
      throw Alto("«" + q + "» señala " + casan.length + " elementos pulsables, no uno. Usa el texto completo o un selector.", true);
    }
    if (casan.length === 0) throw Alto("ni existe el selector " + q + " ni hay nada pulsable que se llame así", true);
    return casan[0];
  }

  function objetivo(sel, verbo, opciones) {
    var els = null;
    try { els = document.querySelectorAll(sel); }
    catch (e) { els = null; }
    // Ni CSS válido ni nada que case: puede ser el TEXTO del botón.
    if (!els || els.length === 0) return porNombre(sel);
    if (els.length > 1 && !(opciones && opciones.cualquiera)) {
      throw Alto(
        sel + " señala " + els.length + " elementos. Afina el selector, o si da igual cuál usa " +
          "ui." + verbo + "(\\"" + sel + "\\", " + (verbo === "clic" ? "1, " : "") + "{ cualquiera: true }).",
        true,
      );
    }
    var lista = Array.prototype.slice.call(els);
    var visibles = lista.filter(seVe);
    return visibles.length > 0 ? visibles[0] : lista[0];
  }

  // EL CENSO DE CLIC MUERTO, como precondición de la acción y no como medida
  // posterior: una herramienta que se niega a un no-op ANTES de actuar. Lo
  // instala el preludio (\`PRELUDIO_CENSO_CLIC\`) antes que los scripts de la
  // página. Sólo acusa con la cadena ENTERA a cero —elemento, ancestros,
  // document, window y sus \`onclick\`—, y esa asimetría es lo que lo deja
  // incapaz de acusar en falso. FAIL-OPEN sin registro: no medir no es medir mal.
  // (\`REGISTRO\` se lee arriba, antes del guardia.)
  function tieneManejador(el) {
    for (var e = el; e; e = e.parentElement) {
      if (REGISTRO.has(e)) return true;
      if (typeof e.onclick === "function") return true;
    }
    if (REGISTRO.has(document) || typeof document.onclick === "function") return true;
    if (REGISTRO.has(window) || typeof window.onclick === "function") return true;
    return false;
  }

  var texto = function (el) { return (el.textContent || "").replace(/\\s+/g, " ").trim(); };
  var estiloDe = function (el, prop) {
    return (window.getComputedStyle(el).getPropertyValue(prop) || "").trim();
  };
  // \`null\` cuando no está, nunca "": un \`disabled\` presente se lee cadena
  // vacía en HTML, así que confundir ausencia con vacío haría invisible justo
  // el cambio que se quiere ver.
  var atributoDe = function (el, nombre) {
    return el.hasAttribute(nombre) ? el.getAttribute(nombre) : null;
  };
  var seVe = function (el) {
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  var dormir = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // LA VENTANA, en UN solo sitio: toda aserción reintenta hasta que se cumple o
  // hasta que se acaba. El modelo no tiene que acordarse de esperar — que es
  // justo lo que en JSON tampoco tenía que hacer, y la razón de que esta
  // opción no sea "forma libre".
  async function hasta(fn, mensajeSiNo) {
    var limite = Date.now() + VENTANA;
    for (;;) {
      var malo = null;
      try { malo = fn(); }
      catch (e) { if (e && e.__ol) throw e; malo = String((e && e.message) || e); }
      if (!malo) return;
      if (Date.now() >= limite) throw Alto(typeof malo === "string" ? malo : mensajeSiNo, false);
      await dormir(50);
    }
  }

  // UNA AFIRMACIÓN, con la ventana dentro. En el BRAZO SIN ACCIONES —que sólo
  // pide la batería, ver \`programaSinAccionesJs\`— no corta el programa: lo
  // que se cumple aun sin actuar se anota como que no discrimina, y lo que no
  // se cumple es lo esperado. El techo de pared sigue mandando.
  //
  // 🔴 SÓLO DESPUÉS DE LA PRIMERA ACCIÓN. Hasta ahí los dos brazos corren en
  // condiciones idénticas, así que comparar una afirmación de ese tramo no
  // mide nada: es una PRECONDICIÓN («la primera pestaña se ve»), no algo que
  // la promesa diga de la acción. Lo enseñó la primera batería con el brazo
  // (2026-09-22): uno de sus tres avisos era justo eso.
  async function afirmar(descr, fn) {
    presupuesto();
    n++;
    if (!SIN_ACCIONES) { await hasta(fn); return; }
    try {
      await hasta(fn);
      if (acciones > 0) {
        vacuasDe.push([n - 1, descr + " se cumple también sin tus acciones, así que no dice nada de ellas", "vacua", ACTUAL]);
      }
    } catch (e) {
      if (e && e.__tiempo) throw e;
    }
  }

  var ui = {
    async clic(sel, veces, opciones) {
      presupuesto();
      n++;
      acciones++;
      if (SIN_ACCIONES) return;
      var el = objetivo(sel, "clic", opciones);
      if (REGISTRO && !tieneManejador(el)) {
        // El ARREGLO va delante: \`leerFallos\` recorta, y lo último es lo que
        // se pierde con un selector largo.
        throw Alto(
          PROPIA
            ? sel + " no tiene manejador de clic. Si se dispara al verse, usa ui.desplaza(\\"" + sel +
                "\\"). Si al pulsar, engánchale uno. (note: se miraron addEventListener(\\"click\\") y " +
                "onclick en el elemento, sus ancestros, document y window.)"
            : sel + " ya no tiene manejador de clic: lo tenía cuando esta promesa se cumplió.",
          PROPIA,
        );
      }
      var k = Math.max(1, Math.min(10, veces || 1));
      for (var i = 0; i < k; i++) {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
    },
    // LO QUE SE DISPARA AL VERSE: un IntersectionObserver no arranca hasta que
    // el elemento entra en pantalla. Salto instantáneo y no \`smooth\`: el suave
    // es asíncrono y la ventana se gastaría midiendo el scroll, no la promesa.
    async desplaza(sel, opciones) {
      presupuesto();
      n++;
      acciones++;
      if (SIN_ACCIONES) return;
      objetivo(sel, "desplaza", opciones).scrollIntoView({ block: "center", inline: "nearest" });
    },
    async escribe(sel, valor) {
      presupuesto();
      n++;
      acciones++;
      if (SIN_ACCIONES) return;
      var el = uno(sel);
      el.value = String(valor == null ? "" : valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    // LECTURAS: no afirman nada, sirven para capturar el "antes". En JSON esto
    // lo hacía el motor a ciegas; aquí lo decide quien escribió la página.
    async texto(sel) { presupuesto(); return texto(uno(sel)); },
    async estilo(sel, prop) { presupuesto(); return estiloDe(uno(sel), String(prop)); },
    async atributo(sel, nombre) { presupuesto(); return atributoDe(uno(sel), String(nombre)); },
    // ASERCIONES: todas con la ventana dentro.
    async visible(sel) {
      await afirmar("ui.visible(" + JSON.stringify(sel) + ")", function () {
        return seVe(uno(sel)) ? null : sel + " debía verse y no se ve";
      });
    },
    async oculto(sel) {
      await afirmar("ui.oculto(" + JSON.stringify(sel) + ")", function () {
        return seVe(uno(sel)) ? sel + " debía estar oculto y se ve" : null;
      });
    },
    async contiene(sel, txt) {
      var busca = String(txt).toLowerCase();
      await afirmar("ui.contiene(" + JSON.stringify(sel) + ", " + JSON.stringify(String(txt)) + ")", function () {
        var t = texto(uno(sel));
        return t.toLowerCase().indexOf(busca) === -1
          ? sel + ' debía contener "' + txt + '" y dice "' + t.slice(0, 40) + '"'
          : null;
      });
    },
    async es(sel, txt) {
      await afirmar("ui.es(" + JSON.stringify(sel) + ", " + JSON.stringify(String(txt)) + ")", function () {
        var t = texto(uno(sel));
        return t !== String(txt) ? sel + ' debía ser "' + txt + '" y es "' + t.slice(0, 40) + '"' : null;
      });
    },
    async cambiaDe(sel, antes) {
      await afirmar("ui.cambiaDe(" + JSON.stringify(sel) + ", antes)", function () {
        var t = texto(uno(sel));
        return t === String(antes) ? sel + ' no cambió (sigue diciendo "' + t.slice(0, 40) + '")' : null;
      });
    },
    // LA COMPROBACIÓN DE ESTILO: es la única que ve el punto ciego MEDIDO —
    // escribir el comportamiento y olvidar el CSS del estado que activa. La
    // clase se pone, no hay error, la consola está limpia y el control queda
    // mudo. Por eso sobrevive de la spec JSON al JS.
    async estiloCambiaDe(sel, prop, antes) {
      var p = String(prop);
      await afirmar("ui.estiloCambiaDe(" + JSON.stringify(sel) + ", " + JSON.stringify(p) + ", antes)", function () {
        var ahora = estiloDe(uno(sel), p);
        if (!ahora && !antes) return sel + " no tiene la propiedad " + p + " (¿es ése su nombre?)";
        return ahora === String(antes) ? sel + ' no cambió su ' + p + ' (sigue en "' + ahora.slice(0, 40) + '")' : null;
      });
    },
    // EL ESTADO DE UN CONTROL, que no vive ni en el texto ni en el CSS. Es el
    // hermano de \`estiloCambiaDe\` y existe por lo mismo: en la corrida del
    // 2026-09-04 el modelo quiso comprobar «el botón deja de estar
    // deshabilitado» y, sin este verbo, usó el de estilo con \`disabled\` — que
    // es un ATRIBUTO. La prueba falló sobre una página que funcionaba.
    async atributoCambiaDe(sel, nombre, antes) {
      var nom = String(nombre);
      var previo = antes === undefined ? null : antes;
      await afirmar("ui.atributoCambiaDe(" + JSON.stringify(sel) + ", " + JSON.stringify(nom) + ", antes)", function () {
        var ahora = atributoDe(uno(sel), nom);
        if (previo === null && ahora === null) {
          return sel + " no tiene el atributo " + nom + " ni antes ni después (¿es ése su nombre, y ése el elemento?)";
        }
        if (ahora === previo) {
          return sel + " no cambió su atributo " + nom +
            (ahora === null ? " (sigue sin tenerlo)" : ' (sigue en "' + String(ahora).slice(0, 40) + '")');
        }
        return null;
      });
    },
    async espera(ms) {
      presupuesto();
      await dormir(Math.max(0, Math.min(3000, Number(ms) || 0)));
    },
  };

  // Lo que ya no cabe en el techo se marca SIN CORRER, desde \`desde\` hasta el
  // final. Ver la cabecera de \`programaSuiteJs\`.
  function sinCorrerDesde(desde) {
    for (var r = desde; r < PROGRAMAS.length; r++) fallos.push([0, "sin tiempo para correrla", "sin_correr", r]);
  }

  for (var k = 0; k < PROGRAMAS.length; k++) {
    PROPIA = PROGRAMAS[k].propia;
    SIN_ACCIONES = !!PROGRAMAS[k].sinAcciones;
    ACTUAL = k;
    acciones = 0;
    vacuasDe = [];
    n = 0;
    llamadas = 0;
    if (Date.now() > finPared) { sinCorrerDesde(k); break; }
    // COMPILAR PRIMERO, y por separado: un error de sintaxis del modelo se caza
    // aquí y se cuenta como fallo de la PRUEBA. Si el código fuera literal, este
    // catch no existiría — el script entero no parsearía.
    var prog;
    try {
      prog = new Function("ui", "return (async () => {\\n" + PROGRAMAS[k].codigo + "\\n})();");
    } catch (e) {
      fallos.push([0, "tu prueba no compila: " + String((e && e.message) || e), "prueba", k]);
      continue;
    }
    var completo = false;
    try {
      await prog(ui);
      completo = true;
    } catch (e) {
      if (e && e.__tiempo && !PROPIA) { sinCorrerDesde(k); break; }
      if (e && e.__ol) fallos.push([n > 0 ? n - 1 : 0, e.__mensaje, e.__deLaPrueba ? "prueba" : null, k]);
      // Cualquier otro error es del PROGRAMA del modelo, no de la página: una
      // variable que no existe, un await mal puesto, una llave de más. Se dice
      // como fallo de la prueba — «una prueba que no se pudo correr no acusa a
      // nadie».
      else fallos.push([n > 0 ? n - 1 : 0, "tu prueba lanzó: " + String((e && e.message) || e), "prueba", k]);
    }
    // EL BRAZO SIN ACCIONES, al cerrar el programa. Una promesa que no pidió
    // ninguna acción tiene los dos brazos IDÉNTICOS: comparar no mide nada, y
    // eso se dice en vez de contar sus afirmaciones una a una. Sólo si terminó:
    // si se paró antes de su primera acción, eso no está medido.
    if (SIN_ACCIONES) {
      if (completo && acciones === 0) {
        fallos.push([0, "tu promesa no pide ninguna acción: con ellas y sin ellas es la misma, así que no mide la conducta", "vacua", k]);
      } else if (acciones > 0) {
        for (var v = 0; v < vacuasDe.length; v++) fallos.push(vacuasDe[v]);
      }
    }
  }
  return fallos;
})();
`;
}

/** Lo que devuelve el navegador → fallos tipados. Cualquier forma inesperada se
 *  descarta: no medir no es medir mal. */
export function leerFallos(bruto: unknown): FalloSpec[] {
  if (!Array.isArray(bruto)) return [];
  const out: FalloSpec[] = [];
  for (const f of bruto) {
    if (!Array.isArray(f) || f.length < 2) continue;
    const paso = Number(f[0]);
    const mensaje = String(f[1]);
    // El tercer elemento es opcional a propósito: sin él se lee como antes —
    // fallo de la PÁGINA— así que un resultado viejo sigue significando lo
    // mismo.
    // 🔴 LO QUE NO DISCRIMINA NO ES UN FALLO, y se filtra aquí. Si se colara,
    // todo el que hace `f.deLaPrueba !== true` lo leería como «la página no
    // cumplió». Lo recoge `leerVacuas`.
    if (f[2] === "vacua") continue;
    // LO QUE NO LLEGÓ A CORRER tampoco es un fallo: ver `leerSinCorrer`.
    if (f[2] === "sin_correr") continue;
    const deLaPrueba = f[2] === "prueba";
    const programa = f.length > 3 && Number.isInteger(f[3]) ? Number(f[3]) : undefined;
    if (Number.isFinite(paso) && mensaje) {
      out.push({
        paso: paso + 1,
        mensaje: mensaje.slice(0, TOPE_MENSAJE),
        ...(deLaPrueba ? { deLaPrueba } : {}),
        ...(programa !== undefined ? { programa } : {}),
      });
    }
  }
  return out;
}

/**
 * LAS PROMESAS QUE NO LLEGARON A CORRER, por su índice de programa — el techo
 * de pared se agotó antes. No son fallos: quien las lea tiene que tratarlas
 * como NO COMPROBADAS, ni rotas ni sanas. Sin este canal, una guardada que se
 * quedó sin tiempo se contaría como comprobada y, si estaba rota, como
 * arreglada sin haberla mirado.
 */
export function leerSinCorrer(bruto: unknown): number[] {
  if (!Array.isArray(bruto)) return [];
  const out: number[] = [];
  for (const f of bruto) {
    if (Array.isArray(f) && f[2] === "sin_correr" && Number.isInteger(f[3])) out.push(Number(f[3]));
  }
  return out;
}

/**
 * LO QUE SE CUMPLE TAMBIÉN SIN LAS ACCIONES — lo que devuelve el brazo de
 * control (`programaSinAccionesJs`). No son fallos: son afirmaciones que no
 * discriminan, o una promesa que no pide ninguna acción. Se miden y no acusan.
 */
export function leerVacuas(bruto: unknown): FalloSpec[] {
  if (!Array.isArray(bruto)) return [];
  const out: FalloSpec[] = [];
  for (const f of bruto) {
    if (!Array.isArray(f) || f[2] !== "vacua") continue;
    const paso = Number(f[0]);
    const mensaje = String(f[1]);
    if (Number.isFinite(paso) && mensaje) out.push({ paso: paso + 1, mensaje: mensaje.slice(0, TOPE_MENSAJE) });
  }
  return out;
}

const listarFallos = (fs: readonly FalloSpec[]): string =>
  fs.slice(0, 4).map((f) => `paso ${f.paso}: ${f.mensaje}`).join(" · ");

/**
 * LAS DOS POBLACIONES DE UN FALLO, QUE NO SE MEZCLAN.
 *
 * `deLaPrueba` lo pone `leerFallos` desde que existe (ver `FalloSpec`), y hasta
 * el 2026-09-21 su ÚNICO consumidor era el `break` que evita reintentar. Las
 * frases que salían de aquí —la del usuario y la del modelo, `avisoSpec`, que
 * se fue con el DSL— lo ignoraban, así que un fallo DEL INSTRUMENTO se contaba
 * como un fallo DE LA PÁGINA, y en el canal del modelo además disparaba una
 * reescritura del runtime.
 *
 * MEDIDO EN PRODUCCIÓN el 2026-09-21 sobre `projectChatMessages`: de 40 turnos
 * con verificación, 2 traían una prueba declarada fallida, y **2 de 2 eran del
 * instrumento** —un selector que señalaba 10 elementos donde el paso necesita
 * uno—. Los 2 salieron con la tarjeta en `ok` y le pidieron al dueño que
 * revisara una página sana. Con los 3 de la corrida del 2026-09-04 van **0 de
 * 5**: ni una sola vez ha acertado acusando.
 *
 * 🔴 LA FORMA ES LA DEL `Edit` DE CLAUDE CODE, medida contra el arnés real y no
 * recordada: con un `old_string` que casa dos veces contesta «Found 2 matches
 * of the string to replace, but replace_all is false. To replace all
 * occurrences, set replace_all to true. To replace only one occurrence, please
 * provide more context to uniquely identify the instance.» y devuelve la cadena
 * literal debajo. Tres propiedades, y las tres faltaban aquí:
 *
 *   1. el HECHO contado («casa 2 veces»), nunca un veredicto («falló»);
 *   2. NI UNA palabra sobre el sujeto — jamás dice que el fichero esté mal;
 *   3. el arreglo NOMBRADO y ramificado por intención (`replace_all` si querías
 *      todas, más contexto si querías una).
 *
 * Y ninguna de sus formas —tampoco «String to replace not found in file.» ni
 * «File does not exist.»— le pide al usuario que vaya a mirar nada. Eso último
 * es exactamente lo que hacía `notaSpec` con su «dime si quieres que lo revise».
 */
function partirFallos(fallos: readonly FalloSpec[]): {
  readonly pagina: readonly FalloSpec[];
  readonly prueba: readonly FalloSpec[];
} {
  return {
    pagina: fallos.filter((f) => !f.deLaPrueba),
    prueba: fallos.filter((f) => f.deLaPrueba),
  };
}

/**
 * LOS FALLOS DE LA PROMESA, DICHOS COMO NOTA Y NO COMO ACUSACIÓN.
 *
 * 🔴 POR QUÉ UNA NOTA. Nació al lado de `avisoSpec`, que le hablaba al MODELO
 * dentro de un bucle que podía arreglarlo —«arréglalo AHORA con un edit
 * target="runtime"»—. Ese ciclo se retiró el 2026-09-04, y con él la lista de
 * `issues` pasó a ser el texto que el bucle le EMITE AL USUARIO: el dueño de la
 * página estaba leyendo una orden escrita para un modelo, con el nombre de una
 * herramienta interna dentro. `avisoSpec` se fue con el DSL el 2026-09-22, y
 * desde entonces esta nota es la única voz de la promesa — en el Agente
 * (`verify.ts`) y en el Chat (`ai-design`).
 *
 * Y sobre todo: MIDE MAL. De los 3 fallos de `prueba` de la corrida del
 * 2026-09-04, CERO eran de la página —un verbo que faltaba y dos pruebas que no
 * rellenaban campos obligatorios—. Un comprobador que acierta 0 de 3 no tiene
 * autoridad para declarar rota la página de nadie: dice lo que vio y se calla.
 * Es la disciplina del `Edit` de Claude Code puesta aquí — **fallar en seguro**:
 * cuando la comprobación no puede sostener la acusación, no acusa.
 *
 * Se dice igual, y por eso esto existe en vez de un borrado: el modelo la lee
 * en el turno siguiente (va al texto del turno) y el usuario puede pedir el
 * arreglo, que es quien decide. Ver la nota de `verify.ts`.
 */
export function notaSpec(fallos: readonly FalloSpec[]): string {
  const { pagina, prueba } = partirFallos(fallos);

  // NO SE MIDIÓ NADA, así que no se dice nada de la página — y sobre todo NO se
  // ofrece revisarla. Esa oferta es la que mandaba al dueño a perseguir un
  // fallo que no existe, y es justo lo que el `Edit` de Claude Code no hace
  // nunca: la queja es de la cadena que le diste, jamás del fichero. Ver
  // `partirFallos` para las tres propiedades y la medición de 0 de 5.
  if (pagina.length === 0) {
    return `Mi propia comprobación no llegó a correr, así que no dice nada sobre la página — ${listarFallos(prueba)}. El cambio está guardado.`;
  }

  const base = `Comprobé en un navegador la promesa que declaré para este cambio y no se cumplió — ${listarFallos(pagina)}. El cambio está guardado; dime si quieres que lo revise.`;
  if (prueba.length === 0) return base;
  return `${base} Aparte, ${listarFallos(prueba)} — eso falló en mi comprobación, no en la página.`;
}

/**
 * EL BLOQUE DE PROMPT DE LA RUTA JS — RESTITUIDO el 2026-09-21.
 *
 * 🔴 Se retiró el 2026-09-05 (la lápida sigue abajo) porque su única puerta
 * —`OPENLEN_PRUEBA_JS=1`— desapareció y el bloque quedó sin forma de llegar a
 * ningún modelo. La razón era correcta y ya no aplica: el Agente tiene desde
 * hoy la ranura `prueba_js`, así que la puerta existe.
 *
 * Y la propia lápida decía dónde tenía sentido: «Editar y el Agente SÍ declaran
 * pruebas, y ahí el modelo puede mirar su propia página».
 *
 * LA FORMA ES LA DEL MODO CÓDIGO DE OpenCode: JavaScript libre con contrato
 * acotado —tope de tamaño, techo de pared, tope de llamadas— en vez de un
 * mini-lenguaje de pasos. Lo que el host pone son los PRIMITIVOS; el pegamento
 * lo escribe el modelo. (⚰️ Aquí decía que era la forma de `preflight.js` de
 * los artifacts de Claude Code. No lo es: aquél corre en las copias ABIERTAS
 * de una página cuando se publica otra versión — un gancho de actualización,
 * no una prueba.)
 *
 * `sujeto` es cómo se llama la prueba en la superficie que la lee: el
 * parámetro `prueba_js` en el Agente, el bloque `<prueba>` en el Chat. El resto
 * es el MISMO texto en las dos — un vocabulario, no dos.
 */
export function pruebaJsPromptBlock(sujeto = "`prueba_js`"): string {
  return [
    `${sujeto} es tu prueba como programa JavaScript, con \`await\` y \`document\` enteros, contra la página que acabas de guardar. Lo que tarda en cumplirse no necesita nada: cada afirmación ya espera sola. Si lo que pulsas exige campos, RELLÉNALOS antes con \`ui.escribe\`: el navegador no dispara el \`submit\` de un formulario al que le falta un \`required\`.`,
    "ACTUAR: `ui.clic(sel, veces?)` · `ui.desplaza(sel)` para lo que se dispara AL VERSE · `ui.escribe(sel, valor)` · `ui.espera(ms)`. Un botón SIN id se nombra por su TEXTO: `ui.clic(\"Añadir al carrito\")`. Si el selector señala varios y da igual cuál, `ui.clic(\".tab\", 1, { cualquiera: true })`. LEER, para guardarte el ANTES: `ui.texto(sel)` · `ui.estilo(sel, prop)` · `ui.atributo(sel, nombre)`. AFIRMAR, fallan solas y esperan hasta " + VENTANA_PRUEBA_MS + " ms: `ui.visible` · `ui.oculto` · `ui.contiene(sel, txt)` · `ui.es(sel, txt)` · `ui.cambiaDe(sel, antes)` · `ui.estiloCambiaDe(sel, prop, antes)` · `ui.atributoCambiaDe(sel, nombre, antes)`. Todas con `await`.",
    // Los TOPES no se enumeran aquí a propósito: el rechazo los nombra cuando
    // se pasan, y adelantarlos gasta catálogo para decir dos veces lo mismo.
    // Es lo que hace el `Edit` de Claude Code — su descripción no lista sus
    // modos de fallo; los listan sus errores.
    "🔴 GUARDA EL ANTES Y COMPARA, o tu prueba no dice que lo movieras TÚ: `var t = await ui.texto(\"#total\"); await ui.clic(\"#add\"); await ui.cambiaDe(\"#total\", t);`.",
  ].join(" ");
}

// ⚰️ `pruebaJsPromptBlock` — EL BLOQUE DE PROMPT DE LA OPCIÓN A, RETIRADO
// (2026-09-05).
//
// Enseñaba los verbos `ui.*` para que el modelo escribiera su prueba como
// JavaScript normal en vez de como una spec JSON. Era la mitad B de un
// experimento —«B primero y luego A, midiendo cada paso»— y su única puerta era
// `OPENLEN_PRUEBA_JS=1` en `app/api/generate/system-prompt.ts`.
//
// Esa puerta se fue con la prueba declarada entera, así que este bloque quedó
// sin forma de llegar a ningún modelo. Una palanca de experimento que se queda
// puesta se convierte en dos productos, y un bloque de prompt que no puede
// enviarse es peor: parece una alternativa disponible. Ver
// [[la-palanca-que-no-vuelve-a-ningun-sitio]].
//
// EL RESTO DE ESTE MÓDULO SIGUE VIVO Y NO SE TOCA: `programaJs` (el motor lo
// ejecuta desde `page-engine/prepare.ts`), `pareceJs` y `validaPruebaJs` (los
// usa `lib/ai-stream/model-prueba.ts`). Editar y el Agente SÍ declaran pruebas,
// y ahí el modelo puede mirar su propia página — que es justo lo que al crear
// no podía, y la razón de que allí la promesa sobrara.
