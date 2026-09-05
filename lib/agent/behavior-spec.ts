// lib/agent/behavior-spec.ts — que el modelo diga QUÉ DEBE PASAR, y que un
// navegador lo compruebe.
//
// POR QUÉ EXISTE. Los ojos ya abren Chrome, pulsan hasta 8 controles y recogen
// lo que revienta. Eso responde «¿explotó?» y nada más. La pregunta que separa
// a un agente que escribe código de uno que lo ENTREGA es la otra: «¿hizo lo
// que prometió?». Una ruleta que gira y no para nunca carga limpia, sale
// perfecta en la foto y no lanza un solo error.
//
// Es el bucle que tiene cualquiera que programa: escribo, EJECUTO, leo el
// fallo, arreglo. Sin la ejecución, el modelo no está programando — está
// redactando código y esperando.
//
// EL DISEÑO, y por qué es así de pequeño:
//
//   · El modelo escribe la prueba, no nosotros. Nadie más sabe qué prometió
//     esa página: OpenLen no puede adivinar que "#total" debe decir 3 tras
//     tres clics. Es el mismo principio que las tarjetas del catálogo — las
//     escribe quien escribe la página.
//   · Un vocabulario CERRADO y diminuto (clic, escribe, entonces). No es un
//     lenguaje de pruebas: es lo justo para comprobar una promesa. Si hiciera
//     falta más, la respuesta no es ampliarlo aquí — es que esa página necesita
//     una prueba de verdad, y eso no cabe en un turno.
//   · Se ejecuta en el MISMO navegador que ya se abrió. Cero arranques nuevos.
//   · FAIL-OPEN. Una prueba que no se pudo correr NO reprueba la página: no
//     medir no es lo mismo que medir mal. Sólo un fallo OBSERVADO cuenta.
//
// PURO hasta el borde: esto arma y valida la especificación y produce el
// programa que corre dentro del navegador. Quien lo ejecuta es lib/ai/inline-image.

/** Lo que debe valer un elemento después de actuar. */
export interface Expectativa {
  /** Selector CSS del elemento que se mira. */
  readonly donde: string;
  /** `cambia` — su texto ya no es el de antes (un contador que avanza, un
   *  resultado que aparece). `contiene` / `es` — comparación literal contra su
   *  texto. `visible` / `oculto` — el elemento se ve o no.
   *
   *  🔴 `estilo` — la propiedad CSS que nombra `valor` CAMBIA de valor
   *  calculado. Es el detector del SEGUNDO punto ciego medido del JavaScript
   *  del modelo: una clase que el script pone y que nadie define en el CSS
   *  deja el control MUDO —se ejecuta, no lanza, consola limpia, y no se
   *  nota—. Las otras cinco no lo ven: un botón que "se pone activo", una
   *  fila que se tacha o un tema que se vuelve oscuro no cambian de texto ni
   *  de visibilidad. */
  readonly que: "cambia" | "contiene" | "es" | "visible" | "oculto" | "estilo";
  /** Requerido por `contiene` y `es` (el texto a comparar) y por `estilo` (el
   *  NOMBRE de la propiedad: `background-color`, `text-decoration`, o una
   *  variable como `--ol-bg`). Ignorado por los demás.
   *
   *  Que `estilo` pida el nombre y no el valor es deliberado: el modelo no
   *  puede predecir cómo serializa el navegador un color (`red` sale
   *  `rgb(255, 0, 0)`), y una expectativa que exige adivinar la serialización
   *  falla por motivos que no son la página. El nombre sí lo sabe: es el que
   *  acaba de escribir en su propio CSS. */
  readonly valor?: string;
}

/** Un paso: actuar, y comprobar. */
export interface PasoSpec {
  /** Selector a pulsar. */
  readonly clic?: string;
  /** Cuántas veces pulsar. 1 por omisión, máximo 10 — más es un bucle, y un
   *  bucle en una prueba declarativa es una forma cara de colgar el turno. */
  readonly veces?: number;
  /** Escribir en campos antes de pulsar: { "#precio": "100" }. */
  readonly escribe?: Readonly<Record<string, string>>;
  /** Qué debe haber pasado después. Al menos una. */
  readonly entonces: readonly Expectativa[];
}

export type SpecRechazo =
  | "vacia"
  | "demasiados_pasos"
  /** NINGÚN paso de la prueba pulsa ni escribe. Es de la LISTA entera, no de un
   *  paso: mirar cosas quietas comprueba el HTML, no el comportamiento. */
  | "sin_accion"
  /** Un paso que no es ni un objeto, o cuyo `escribe` no lo es. Antes también
   *  se llamaba `sin_accion`, y compartir nombre con lo de arriba hacía que el
   *  aviso le hablara al modelo de acciones cuando el problema era la FORMA. */
  | "paso_invalido"
  | "sin_expectativa"
  | "selector_invalido"
  | "falta_valor";

export type SpecResultado =
  | { readonly kind: "ninguna" }
  | { readonly kind: "spec"; readonly pasos: readonly PasoSpec[] }
  /** `paso` es 1-indexado, o undefined cuando el rechazo es de la lista entera
   *  (`vacia`, `demasiados_pasos`). Existe porque sin él el aviso decía «un
   *  paso no hacía nada» sobre una lista de hasta seis, y el modelo tenía que
   *  adivinar cuál: MEDIDO el 2026-08-30, reintentó cinco veces y se quedó sin
   *  turnos. El aviso hermano —`avisoSpec`, para una prueba que SÍ corrió y
   *  falló— siempre nombró el paso; el de rechazo no, y son el mismo problema
   *  de quien lo lee. */
  | { readonly kind: "error"; readonly reason: SpecRechazo; readonly paso?: number };

/** Seis pasos. Una promesa de una página cabe de sobra; más es alguien
 *  escribiendo una suite dentro de un turno del chat. */
export const MAX_PASOS = 6;
export const MAX_VECES = 10;

/**
 * CUÁNTO SE ESPERA a que la promesa se cumpla, por paso.
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
 * 1,5 s cubre el intervalo de un segundo con margen. Sólo lo paga el paso que
 * FALLA: en cuanto todas sus expectativas se cumplen, se sigue al siguiente.
 */
export const VENTANA_PRUEBA_MS = 1_500;

/**
 * ⚰️ AQUÍ HABÍA UNA REGEX que decidía si un selector era «simple». Retirada el
 * 2026-09-04, y el motivo está MEDIDO sobre una corrida de 16 páginas:
 *
 * De las 11 pruebas que el modelo declaró, **2 se tiraron por esta regex** —
 * `#admisiones a.btn-primary` y `#drink-list .drink-card:nth-child(3)`—. La
 * segunda duele especialmente: `:nth-child` es *la forma estándar de CSS* de
 * señalar UN elemento entre hermanos, que es literalmente lo que el prompt
 * pide. El modelo obedeció la intención y lo rechazó la letra.
 *
 * 🔴 Y la regla que aplicábamos NO era la que decíamos. El prompt prometía
 * «selectores simples (#id, .clase, etiqueta)», mientras la regex aceptaba
 * `#reserva a` —descendencia, que el prompt no menciona— y rechazaba un
 * compuesto. Contra una regla que no se puede leer, el modelo no puede ganar.
 *
 * LO QUE LA SUSTITUYE, y es la misma disciplina que el `Edit` de Claude Code
 * («casa exactamente una vez o falla»): se CUENTA en el navegador con
 * `querySelectorAll(sel).length`, dentro del helper `uno()` de `specProgram`.
 * Ahí un selector inválido, ausente o ambiguo se marca como fallo DE LA PRUEBA
 * y no acusa a la página. Teníamos un Chromium abierto y estábamos deduciendo
 * con una regex lo que se podía medir — ver [[render-measured-contrast]].
 *
 * Aquí sólo queda la cordura de tamaño: una cadena no vacía que quepa.
 */
function selectorValido(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0 && s.length <= 80 && !/[\n\r]/.test(s);
}

/** El NOMBRE de una propiedad CSS: `background-color`, `text-decoration`, o una
 *  variable de tema `--ol-bg`. Nada más — ni valores, ni declaraciones enteras
 *  con `:`, que es la confusión natural al leer «estilo». */
const PROPIEDAD_CSS_OK = /^(?:--)?[a-z][a-z-]{1,38}$/;

function propiedadCssValida(s: unknown): s is string {
  return typeof s === "string" && PROPIEDAD_CSS_OK.test(s.trim());
}

/**
 * Valida lo que el modelo emitió. Rechaza entero, nunca a medias: una spec con
 * un paso bueno y uno inválido probaría la mitad de la promesa y diría que
 * pasó — que es peor que no probar.
 */
export function parseBehaviorSpec(raw: unknown): SpecResultado {
  if (raw === undefined || raw === null) return { kind: "ninguna" };
  if (!Array.isArray(raw) || raw.length === 0) return { kind: "error", reason: "vacia" };
  if (raw.length > MAX_PASOS) return { kind: "error", reason: "demasiados_pasos" };

  const pasos: PasoSpec[] = [];
  // El paso que se está mirando, 1-indexado. Los ya aceptados van en `pasos`,
  // así que el actual es el siguiente. Va en cada rechazo de dentro del bucle:
  // el modelo no puede arreglar «un paso no hacía nada» sobre una lista de seis.
  const rechazo = (reason: SpecRechazo): SpecResultado => ({
    kind: "error",
    reason,
    paso: pasos.length + 1,
  });
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") return rechazo("paso_invalido");

    const escribe: Record<string, string> = {};
    if (p.escribe !== undefined) {
      if (typeof p.escribe !== "object" || p.escribe === null) {
        return rechazo("paso_invalido");
      }
      for (const [sel, val] of Object.entries(p.escribe as Record<string, unknown>)) {
        if (!selectorValido(sel)) return rechazo("selector_invalido");
        escribe[sel] = String(val ?? "").slice(0, 120);
      }
    }
    const clic = typeof p.clic === "string" ? p.clic.trim() : undefined;
    if (clic !== undefined && !selectorValido(clic)) {
      return rechazo("selector_invalido");
    }
    // (La acción ya no se exige AQUÍ — ver la comprobación al salir del bucle.)

    const entonces = Array.isArray(p.entonces) ? (p.entonces as Record<string, unknown>[]) : [];
    if (entonces.length === 0) return rechazo("sin_expectativa");
    const exps: Expectativa[] = [];
    for (const e of entonces) {
      if (!e || typeof e !== "object" || !selectorValido(e.donde)) {
        return rechazo("selector_invalido");
      }
      const que = e.que;
      if (
        que !== "cambia" && que !== "contiene" && que !== "es" &&
        que !== "visible" && que !== "oculto" && que !== "estilo"
      ) {
        return rechazo("sin_expectativa");
      }
      if ((que === "contiene" || que === "es") && typeof e.valor !== "string") {
        return rechazo("falta_valor");
      }
      // `estilo` pide el NOMBRE de una propiedad, no un texto cualquiera. Se
      // comprueba la forma aquí y no en el navegador porque un nombre inventado
      // devuelve "" en las dos medidas —antes y después— y eso se leería como
      // «no cambió»: la prueba acusaría a la página de un fallo que es del
      // nombre. Se aceptan las propiedades normales y las variables `--x`.
      if (que === "estilo" && !propiedadCssValida(e.valor)) {
        return rechazo("falta_valor");
      }
      exps.push({
        donde: String(e.donde).trim(),
        que,
        ...(typeof e.valor === "string" ? { valor: e.valor.slice(0, 120) } : {}),
      });
    }

    const veces = typeof p.veces === "number" && Number.isFinite(p.veces)
      ? Math.min(MAX_VECES, Math.max(1, Math.floor(p.veces)))
      : 1;

    pasos.push({
      ...(clic ? { clic } : {}),
      ...(Object.keys(escribe).length ? { escribe } : {}),
      veces,
      entonces: exps,
    });
  }

  // LA PRUEBA ENTERA necesita al menos una acción; su PRIMER paso no.
  //
  // La intención de siempre es correcta y se conserva: mirar elementos quietos
  // no comprueba una promesa de comportamiento, comprueba el HTML. Lo que
  // estaba mal era el nivel al que se exigía. Si algún paso pulsa o escribe, la
  // prueba SÍ ejerce el comportamiento — da igual que el primero se limite a
  // mirar cómo estaba la cosa antes.
  //
  // 🔴 MEDIDO dos veces, el 2026-08-30, en `contador-se-construye`: el modelo
  // escribe «el contador muestra 0» y luego «pulso +, muestra 1» — que es como
  // se escribe una prueba en cualquier sitio: se fija el estado inicial y
  // después se actúa. Le tirábamos la prueba ENTERA por su primer paso,
  // reintentaba, volvía a escribirla igual, y agotaba `turn_limit`: cinco
  // vueltas quemadas y el turno muerto. Mejorar el texto del rechazo NO lo
  // arregló —se probó y salió igual—, porque el modelo no estaba desinformado:
  // estaba escribiendo la prueba bien y la regla estaba mal.
  //
  // Es el mismo movimiento del 2026-08-22, que ya soltó los pasos POSTERIORES
  // por esta misma razón. Faltaba soltar el primero.
  if (!pasos.some((p) => p.clic !== undefined || p.escribe !== undefined)) {
    return { kind: "error", reason: "sin_accion" };
  }
  return { kind: "spec", pasos };
}

/**
 * LA PRUEBA QUE EL MODELO DECLARÓ, en cualquiera de sus dos formas.
 *
 * Vive aquí y no en `prueba-js.ts` para que no haya ciclo: `prueba-js` importa
 * de este fichero, no al revés.
 *
 * Las dos rutas conviven a propósito desde el 2026-09-04 — así se puede medir
 * una contra otra moviendo SÓLO el prompt, en vez de arrancar la que funciona
 * para probar la que no se ha medido. `spec` es el JSON de siempre; `js` es el
 * programa del modelo sobre los primitivos `ui.*`.
 */
export type PruebaDeclarada =
  | { readonly modo: "spec"; readonly pasos: readonly PasoSpec[] }
  | { readonly modo: "js"; readonly codigo: string };

/** Lo que un paso falló, en la lengua del usuario — la lee él, y también el
 *  modelo, que necesita saber QUÉ elemento y QUÉ se esperaba. */
export interface FalloSpec {
  readonly paso: number;
  readonly mensaje: string;
  /** `true` cuando lo que falla es LA PRUEBA, no la página: un selector que no
   *  señala a nada o que señala a varios. No acusa al documento y no puede
   *  disparar una reparación — «una prueba que no se pudo correr no acusa a
   *  nadie», la misma regla fail-soft que ya rige la spec mal formada. */
  readonly deLaPrueba?: boolean;
}

/**
 * El programa que corre DENTRO del navegador.
 *
 * VA COMO CADENA, nunca como función. `page.evaluate(() => …)` pasa por
 * esbuild/tsx, que inyecta el ayudante `__name` para conservar nombres — y
 * `__name` no existe en el navegador, así que la evaluación revienta con un
 * error que no tiene nada que ver con la página. Ya costó una sesión
 * ([[render-measured-contrast]]); la cadena no pasa por ningún transformador.
 *
 * El JSON se incrusta con `JSON.stringify` DOS veces: una para el valor y otra
 * para que el literal sobreviva dentro de la cadena.
 */
export function specProgram(pasos: readonly PasoSpec[]): string {
  return `
(async () => {
  var PASOS = ${JSON.stringify(JSON.stringify(pasos))};
  var VENTANA = ${VENTANA_PRUEBA_MS};
  var pasos = JSON.parse(PASOS);
  var fallos = [];
  // Un clic que navega se lleva la página y con ella la comprobación. Se
  // impide sólo la acción por defecto: el manejador del modelo corre igual.
  //
  // 🔴 SALVO EN UN BOTÓN DE ENVÍO, y esto era un FALSO POSITIVO medido el
  // 2026-09-04. La frase de arriba —«el manejador del modelo corre igual»— es
  // falsa para un \`type="submit"\`: la acción por defecto de ese clic ES
  // disparar el evento \`submit\` del formulario, que es justo donde el modelo
  // engancha su manejador. Cancelarla aquí hacía que el manejador NO corriera
  // nunca, y la prueba acusaba a una página perfecta de no enseñar su mensaje
  // de éxito. Comprobado en un navegador de verdad, con brazo de control:
  // sin la guarda el manejador corre, con ella no.
  //
  // No hace falta cancelar nada aquí: la navegación que ese envío provocaría
  // ya la para el listener de \`submit\` de la línea siguiente.
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("button,input") : null;
    if (t && t.form && t.type === "submit") return;
    e.preventDefault();
  }, true);
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);

  // ¿ESTE SELECTOR SEÑALA UN ELEMENTO? Se CUENTA en el navegador, no se
  // adivina con una expresión regular en el servidor — es la misma regla que
  // usa el Edit de Claude Code («casa exactamente una vez o falla») y el mismo
  // principio que [[render-measured-contrast]]: si hay un navegador abierto,
  // se mide, no se deduce.
  //
  // Devuelve \`{el}\` o \`{err}\`. Un \`err\` de aquí NO es un fallo de la página:
  // es una prueba que no se puede aplicar, y se marca como tal.
  var uno = function (sel) {
    var els;
    try { els = document.querySelectorAll(sel); }
    catch (e) { return { err: "el selector " + sel + " no es CSS válido" }; }
    if (els.length === 0) return { err: "no existe " + sel };
    if (els.length > 1) return { err: sel + " señala " + els.length + " elementos, no uno" };
    return { el: els[0] };
  };

  var texto = function (el) { return (el.textContent || "").replace(/\\s+/g, " ").trim(); };
  var seVe = function (el) {
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  var espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var estiloDe = function (el, prop) {
    return (window.getComputedStyle(el).getPropertyValue(prop) || "").trim();
  };

  // El mensaje del fallo, o null si la expectativa se cumple EN ESTE INSTANTE.
  var comprueba = function (exp, antes, antesEstilo) {
    var r = uno(exp.donde);
    // Devuelve [mensaje, "prueba"] cuando el problema es el selector: la
    // página no puede fallar una expectativa que no señala a nada concreto.
    if (r.err) return [r.err, "prueba"];
    var el = r.el;
    var ahora = texto(el);
    if (exp.que === "cambia") {
      if (ahora === antes[exp.donde]) return exp.donde + ' no cambió (sigue diciendo "' + ahora.slice(0, 40) + '")';
    } else if (exp.que === "contiene") {
      if (ahora.toLowerCase().indexOf(String(exp.valor).toLowerCase()) === -1) {
        return exp.donde + ' debía contener "' + exp.valor + '" y dice "' + ahora.slice(0, 40) + '"';
      }
    } else if (exp.que === "es") {
      if (ahora !== String(exp.valor)) return exp.donde + ' debía ser "' + exp.valor + '" y es "' + ahora.slice(0, 40) + '"';
    } else if (exp.que === "visible") {
      if (!seVe(el)) return exp.donde + " debía verse y no se ve";
    } else if (exp.que === "oculto") {
      if (seVe(el)) return exp.donde + " debía estar oculto y se ve";
    } else if (exp.que === "estilo") {
      var prop = String(exp.valor);
      var previo = antesEstilo[exp.donde + "|" + prop];
      var actual = estiloDe(el, prop);
      // Vacío en las DOS medidas = el nombre no le dice nada al navegador.
      // Decirlo así, y no "no cambió", es la diferencia entre que el modelo
      // corrija el nombre y que se ponga a reescribir un script que está bien.
      if (!actual && !previo) {
        return exp.donde + " no tiene la propiedad " + prop + " (¿es ése su nombre?)";
      }
      if (actual === previo) {
        return exp.donde + ' no cambió su ' + prop + ' (sigue en "' + actual.slice(0, 40) + '")';
      }
    }
    return null;
  };

  for (var i = 0; i < pasos.length; i++) {
    var p = pasos[i];
    // ANTES: se guarda el texto de cada objetivo para poder decir si "cambia",
    // y el valor calculado de cada propiedad que mire un "estilo".
    var antes = {};
    var antesEstilo = {};
    for (var a = 0; a < p.entonces.length; a++) {
      var d = p.entonces[a].donde;
      // Por \`uno()\` y no por \`querySelector\` a pelo: un selector que no es CSS
      // válido LANZA, y aquí estamos FUERA del try — reventaba la medición
      // entera con un error que no tiene nada que ver con la página. Lo cazó su
      // propia prueba de navegador al escribirla.
      var e0 = uno(d).el || null;
      antes[d] = e0 ? texto(e0) : null;
      if (p.entonces[a].que === "estilo") {
        antesEstilo[d + "|" + p.entonces[a].valor] = e0 ? estiloDe(e0, String(p.entonces[a].valor)) : "";
      }
    }

    try {
      if (p.escribe) {
        for (var sel in p.escribe) {
          var rc = uno(sel);
          // El tercer elemento marca que el fallo es DE LA PRUEBA, no de la
          // página: un campo que no existe o que sale por duplicado no acusa
          // a nadie, sólo dice que este paso no se pudo aplicar.
          if (rc.err) { fallos.push([i, rc.err, "prueba"]); continue; }
          var campo = rc.el;
          campo.value = p.escribe[sel];
          campo.dispatchEvent(new Event("input", { bubbles: true }));
          campo.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      if (p.clic) {
        var rb = uno(p.clic);
        if (rb.err) {
          fallos.push([i, rb.err, "prueba"]);
          continue;
        }
        var boton = rb.el;
        for (var v = 0; v < (p.veces || 1); v++) {
          boton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
      }
    } catch (err) {
      fallos.push([i, "la acción lanzó: " + (err && err.message ? err.message : String(err))]);
      continue;
    }

    // EN VENTANA, no al instante: casi todo lo que promete una página tarda —
    // un intervalo de un segundo, una transición, un retardo de búsqueda. Se
    // sale en cuanto TODO se cumple, así que un paso que pasa no cuesta nada.
    var mensajes = [];
    var limite = Date.now() + VENTANA;
    while (true) {
      mensajes = [];
      var deLaPrueba = false;
      for (var k = 0; k < p.entonces.length; k++) {
        var m = comprueba(p.entonces[k], antes, antesEstilo);
        if (m) {
          mensajes.push(m);
          if (Array.isArray(m)) deLaPrueba = true;
        }
      }
      // Un selector que no señala a un elemento NO se arregla esperando: se
      // sale ya en vez de pagar la ventana entera por nada.
      if (mensajes.length === 0 || deLaPrueba || Date.now() >= limite) break;
      await espera(50);
    }
    for (var q = 0; q < mensajes.length; q++) {
      var msg = mensajes[q];
      if (Array.isArray(msg)) fallos.push([i, msg[0], "prueba"]);
      else fallos.push([i, msg]);
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
    const deLaPrueba = f[2] === "prueba";
    if (Number.isFinite(paso) && mensaje) {
      out.push({ paso: paso + 1, mensaje: mensaje.slice(0, 200), ...(deLaPrueba ? { deLaPrueba } : {}) });
    }
  }
  return out;
}

/** El aviso PARA EL MODELO. Nombra el paso y el elemento — sin eso, «no
 *  funciona» le manda a mirar al sitio equivocado. */
export function avisoSpec(fallos: readonly FalloSpec[]): string {
  const lista = fallos.slice(0, 4).map((f) => `paso ${f.paso}: ${f.mensaje}`).join(" · ");
  return `TU PROPIA PRUEBA FALLÓ al ejecutarla en un navegador de verdad — ${lista}. La página carga sin errores, así que esto NO es un fallo de sintaxis: el código corre y hace algo distinto de lo que prometiste. Arréglalo AHORA con un edit target="runtime" que lleve el script COMPLETO corregido, y NO le digas al usuario que funciona hasta que la prueba pase.`;
}

/** Frase para el USUARIO cuando la spec venía mal formada. La página NO se
 *  reprueba por esto: una prueba que no se pudo correr no acusa a nadie. */
export function specRechazoAviso(reason: SpecRechazo, paso?: number): string {
  // CADA FRASE DICE CÓMO ARREGLARLO, no sólo qué está mal.
  //
  // MEDIDO el 2026-08-30 (batería del Agente, `contador-se-construye`): con el
  // texto anterior —«un paso no hacía nada (ni pulsar ni escribir)»— el modelo
  // reintentó CINCO veces y agotó `turn_limit` sin acertar una sola. Y era
  // adivinable por qué: el aviso no decía QUÉ paso de los seis, ni la regla,
  // que además es asimétrica —sólo el PRIMER paso necesita acción, los demás
  // pueden sólo mirar—. Sin la regla delante, «ponle acción a todos» es la
  // lectura natural, y es la equivocada.
  // Dos formas, porque son dos sujetos: `vacia` y `demasiados_pasos` hablan de
  // la LISTA entera y nunca traen `paso`; el resto habla de UN paso concreto.
  // Una sola plantilla dejaba a los segundos sin sujeto («…: no pulsa nada»).
  const deLaLista: Partial<Record<SpecRechazo, string>> = {
    vacia: "la prueba venía vacía. Mándala con al menos un paso",
    demasiados_pasos: `la prueba trae más de ${MAX_PASOS} pasos. Quédate con los ${MAX_PASOS} que de verdad prueban la promesa`,
    sin_accion:
      'NINGÚN paso pulsa ni escribe: así se comprueba el HTML, no el comportamiento. Dale a alguno un `clic:"#selector"` o un `escribe:{"#campo":"valor"}` — puede ser cualquiera, no hace falta que sea el primero',
  };
  const delPaso: Partial<Record<SpecRechazo, string>> = {
    paso_invalido:
      "no tiene la forma de un paso. Un paso es un objeto con `clic` y/o `escribe` y su `entonces`",
    sin_expectativa:
      'no dice qué debía pasar después. Añádele `entonces:[{donde:"#selector", que:"cambia"|"contiene"|"es"|"visible"|"oculto"|"estilo"}]`',
    selector_invalido:
      "lleva un selector que no es válido o apunta a varios elementos. Usa un id (#algo) que exista en el documento que acabas de guardar",
    falta_valor:
      'usa `que:"contiene"`, `que:"es"` o `que:"estilo"` sin un `valor` bueno. Las dos primeras comparan contra un TEXTO: añádeselo. `estilo` quiere el NOMBRE de una propiedad CSS —`background-color`, `text-decoration`, `--ol-bg`—, no su valor: el navegador serializa los colores a su manera y adivinar cómo no es tu trabajo',
  };
  const frase =
    deLaLista[reason] ?? `${paso ? `el paso ${paso}` : "un paso"} ${delPaso[reason]}`;
  return `No pude comprobar el comportamiento: ${frase}. El cambio sí se guardó.`;
}
