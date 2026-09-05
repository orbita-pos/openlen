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
 *  que esto es una suite dentro de una generación, igual que `MAX_PRUEBA_BYTES`. */
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
 * ¿Esto es un programa JS o el JSON de siempre?
 *
 * Se decide por la FORMA del contenido, no por un atributo nuevo: así el
 * transporte (`<script data-openlen-prueba>`) no cambia, las dos rutas conviven
 * y se puede medir una contra otra moviendo sólo el prompt. Un contenido que
 * empieza por `[` o `{` es la spec JSON; cualquier otra cosa se trata como JS.
 */
export function pareceJs(bruto: string): boolean {
  const t = bruto.trim();
  if (!t) return false;
  return !(t.startsWith("[") || t.startsWith("{"));
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
export function programaJs(codigo: string): string {
  return `
(async () => {
  var CODIGO = ${JSON.stringify(codigo)};
  var VENTANA = ${VENTANA_PRUEBA_MS};
  var TECHO = ${TECHO_PRUEBA_JS_MS};
  var MAX_LLAMADAS = ${MAX_LLAMADAS_UI};
  var fallos = [];
  var n = 0;              // qué llamada a ui.* vamos: es el "paso" del mensaje
  var llamadas = 0;
  var finPared = Date.now() + TECHO;

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

  function Alto(mensaje, deLaPrueba) {
    var err = new Error(mensaje);
    err.__ol = true;
    err.__mensaje = mensaje;
    err.__deLaPrueba = !!deLaPrueba;
    return err;
  }

  function presupuesto() {
    if (++llamadas > MAX_LLAMADAS) throw Alto("tu prueba pasa de " + MAX_LLAMADAS + " acciones", true);
    if (Date.now() > finPared) throw Alto("tu prueba tardó más de " + (TECHO / 1000) + "s", true);
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
    async clic(sel, veces) {
      presupuesto();
      n++;
      var el = uno(sel);
      var k = Math.max(1, Math.min(10, veces || 1));
      for (var i = 0; i < k; i++) {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
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

  // COMPILAR PRIMERO, y por separado: un error de sintaxis del modelo se caza
  // aquí y se cuenta como fallo de la PRUEBA. Si el código fuera literal, este
  // catch no existiría — el script entero no parsearía.
  var prog;
  try {
    prog = new Function("ui", "return (async () => {\\n" + CODIGO + "\\n})();");
  } catch (e) {
    return [[0, "tu prueba no compila: " + String((e && e.message) || e), "prueba"]];
  }

  try {
    await prog(ui);
  } catch (e) {
    if (e && e.__ol) fallos.push([n > 0 ? n - 1 : 0, e.__mensaje, e.__deLaPrueba ? "prueba" : undefined]);
    // Cualquier otro error es del PROGRAMA del modelo, no de la página: una
    // variable que no existe, un await mal puesto, una llave de más. Se dice
    // como fallo de la prueba — «una prueba que no se pudo correr no acusa a
    // nadie».
    else fallos.push([n > 0 ? n - 1 : 0, "tu prueba lanzó: " + String((e && e.message) || e), "prueba"]);
  }
  return fallos.map(function (f) { return f[2] ? [f[0], f[1], f[2]] : [f[0], f[1]]; });
})();
`;
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
