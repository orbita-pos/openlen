// LA PRUEBA DECLARADA, EN JAVASCRIPT — la opción A, con la forma de CodeMode.
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
// Se investigó qué hacen de verdad las herramientas grandes, leyendo su código:
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
import { VENTANA_PRUEBA_MS } from "./behavior-spec";

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
 * ⚠️ VA COMO CADENA, nunca como función — la misma razón que `specProgram`:
 * `page.evaluate(() => …)` pasa por esbuild/tsx, que inyecta el ayudante
 * `__name`, que no existe en el navegador. Ya costó una sesión entera.
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

/** Una promesa dentro de un programa: su código y de quién es. */
export interface EntradaDePrograma {
  readonly codigo: string;
  /** `true` = la del turno; `false` = una guardada. Ver `programaJs`. */
  readonly propia: boolean;
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
  const programas = entradas.map((e) => ({ codigo: e.codigo, propia: e.propia }));
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

  // EL REGISTRO DEL CENSO, leído ANTES del guardia de abajo. El guardia es un
  // listener de clic en \`document\`, y con el censo puesto marcaría vivo a
  // cualquier botón de la página (medido en el DSL: censo 0 antes, 1 después).
  var REGISTRO = (typeof window !== "undefined" && window.__olCensoClic) || null;
  var documentoYaTenia = REGISTRO ? REGISTRO.has(document) : false;

  // EL GUARDIA, con su excepción. Ver la lápida en behavior-spec.ts: cancelar
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

  var ui = {
    async clic(sel, veces, opciones) {
      presupuesto();
      n++;
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
      objetivo(sel, "desplaza", opciones).scrollIntoView({ block: "center", inline: "nearest" });
    },
    async escribe(sel, valor) {
      presupuesto();
      n++;
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
      presupuesto(); n++;
      await hasta(function () { return seVe(uno(sel)) ? null : sel + " debía verse y no se ve"; });
    },
    async oculto(sel) {
      presupuesto(); n++;
      await hasta(function () { return seVe(uno(sel)) ? sel + " debía estar oculto y se ve" : null; });
    },
    async contiene(sel, txt) {
      presupuesto(); n++;
      var busca = String(txt).toLowerCase();
      await hasta(function () {
        var t = texto(uno(sel));
        return t.toLowerCase().indexOf(busca) === -1
          ? sel + ' debía contener "' + txt + '" y dice "' + t.slice(0, 40) + '"'
          : null;
      });
    },
    async es(sel, txt) {
      presupuesto(); n++;
      await hasta(function () {
        var t = texto(uno(sel));
        return t !== String(txt) ? sel + ' debía ser "' + txt + '" y es "' + t.slice(0, 40) + '"' : null;
      });
    },
    async cambiaDe(sel, antes) {
      presupuesto(); n++;
      await hasta(function () {
        var t = texto(uno(sel));
        return t === String(antes) ? sel + ' no cambió (sigue diciendo "' + t.slice(0, 40) + '")' : null;
      });
    },
    // LA COMPROBACIÓN DE ESTILO: es la única que ve el punto ciego MEDIDO —
    // escribir el comportamiento y olvidar el CSS del estado que activa. La
    // clase se pone, no hay error, la consola está limpia y el control queda
    // mudo. Por eso sobrevive de la spec JSON al JS.
    async estiloCambiaDe(sel, prop, antes) {
      presupuesto(); n++;
      var p = String(prop);
      await hasta(function () {
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
      presupuesto(); n++;
      var nom = String(nombre);
      var previo = antes === undefined ? null : antes;
      await hasta(function () {
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
    try {
      await prog(ui);
    } catch (e) {
      if (e && e.__tiempo && !PROPIA) { sinCorrerDesde(k); break; }
      if (e && e.__ol) fallos.push([n > 0 ? n - 1 : 0, e.__mensaje, e.__deLaPrueba ? "prueba" : null, k]);
      // Cualquier otro error es del PROGRAMA del modelo, no de la página: una
      // variable que no existe, un await mal puesto, una llave de más. Se dice
      // como fallo de la prueba — «una prueba que no se pudo correr no acusa a
      // nadie».
      else fallos.push([n > 0 ? n - 1 : 0, "tu prueba lanzó: " + String((e && e.message) || e), "prueba", k]);
    }
  }
  return fallos;
})();
`;
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
