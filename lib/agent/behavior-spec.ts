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
   *  de visibilidad.
   *
   *  🔴 `atributo` — el atributo HTML que nombra `valor` CAMBIA (aparece,
   *  desaparece o cambia de valor). Es el TERCER punto ciego, y éste no salió
   *  de una teoría: en la corrida del 2026-09-04 el modelo quiso comprobar «el
   *  botón deja de estar deshabilitado» en `quiz` y escribió
   *  `{que:"estilo", valor:"disabled"}` — porque `estilo` era el único verbo
   *  que se le parecía. `disabled` es un ATRIBUTO, no una propiedad CSS, así
   *  que la prueba falló y acusó a una página que funcionaba.
   *
   *  Es la CUARTA vez que un destrozo atribuido al modelo resulta ser un verbo
   *  que faltaba en nuestro vocabulario ([[el-verbo-que-faltaba-op-text]]). El
   *  estado de un control vive en sus atributos —`disabled`, `aria-expanded`,
   *  `checked`, `open`, `hidden`— y ninguno de los otros seis lo ve. */
  readonly que: "cambia" | "contiene" | "es" | "visible" | "oculto" | "estilo" | "atributo";
  /** Requerido por `contiene` y `es` (el texto a comparar), por `estilo` (el
   *  NOMBRE de la propiedad: `background-color`, `text-decoration`, o una
   *  variable como `--ol-bg`) y por `atributo` (el NOMBRE del atributo:
   *  `disabled`, `aria-expanded`). Ignorado por los demás.
   *
   *  Que `estilo` pida el nombre y no el valor es deliberado: el modelo no
   *  puede predecir cómo serializa el navegador un color (`red` sale
   *  `rgb(255, 0, 0)`), y una expectativa que exige adivinar la serialización
   *  falla por motivos que no son la página. El nombre sí lo sabe: es el que
   *  acaba de escribir en su propio CSS.
   *
   *  `atributo` hereda esa misma forma —el nombre, y se comprueba que CAMBIA—
   *  por una razón distinta y más simple: un solo campo `valor` no puede
   *  llevar a la vez el nombre y el valor esperado, y de las dos cosas la que
   *  responde a la promesa medida («deja de estar deshabilitado») es el
   *  cambio. Un vocabulario diminuto es una decisión de este fichero, no una
   *  carencia. */
  readonly valor?: string;
}

/** Un paso: actuar, y comprobar. */
export interface PasoSpec {
  /** Selector a pulsar. */
  readonly clic?: string;
  /**
   * 🔴 DESPLAZAR HASTA VERLO — la acción de lo que se dispara SOLO.
   *
   * MEDIDO el 2026-09-21 en una corrida de la batería, caso
   * `contador-se-construye` («los números suben solos CUANDO SE VEAN»): el
   * runtime salió con 1.168 caracteres y **0 listeners de clic**, porque un
   * `IntersectionObserver` no cablea ninguno. La prueba declarada sólo podía
   * MIRAR, `sin_accion` la rechazó, y al reintentar el modelo mandó lo mismo
   * (`sigue_mal · antes sin_accion · ahora sin_accion`): la regla era
   * insatisfacible para esa familia entera.
   *
   * POR QUÉ UN VERBO Y NO UNA EXENCIÓN. Una exención vuelve la regla
   * instatable —«algún paso debe actuar, salvo cuando…»— y ya está medido lo
   * que cuesta una regla asimétrica sin decir: cinco reintentos y `turn_limit`
   * (2026-08-30, este MISMO caso). Es además la forma de Claude Code cuando su
   * vocabulario se queda corto: `replace_all` en `Edit`, `pages` en `Read`,
   * `run_in_background` en `Bash` — un parámetro que hace la intención
   * explícita, nunca una precondición que se afloja. Y es el movimiento que
   * esta casa ya hizo con `atributo`.
   *
   * POR QUÉ NO HAY TAMBIÉN UN `espera`: lo temporal —cuenta atrás, autoplay,
   * retardo, transición— ya lo cubre `VENTANA_PRUEBA_MS`, que existe justo para
   * eso y los lista. El único hueco era la visibilidad.
   */
  readonly desplaza?: string;
  /** Cuántas veces pulsar. 1 por omisión, máximo 10 — más es un bucle, y un
   *  bucle en una prueba declarativa es una forma cara de colgar el turno. */
  readonly veces?: number;
  /**
   * EL SELECTOR SEÑALA UN GRUPO, Y DA IGUAL CUÁL.
   *
   * 🔴 POR QUÉ EXISTE (2026-09-21 noche). La clase `sin_id` —el modelo cablea
   * con `createElement` o `querySelectorAll('.add')`, sin un solo id— es la que
   * más `sin_accion` produce en producción (3 de 4 proyectos) y la única que no
   * tenía reparación. Y no la tenía porque TODO lo que se puede promover de ese
   * runtime casa con VARIOS elementos, y un selector múltiple se rechazaba.
   *
   * 🔴 ELEGIR UNO POR NUESTRA CUENTA ES INVENTAR UN OBJETIVO, que es lo único
   * que una reparación no puede hacer nunca. La salida es la contraria: ante un
   * objetivo ambiguo no se toca nada, se dice que lo es, y se ofrecen DOS
   * caminos —afina el selector, o DECLARA que da igual cuál—. `cualquiera` es
   * esa declaración: la desambiguación la AUTORIZA el paso, no la adivinamos
   * nosotros. Y el programa dice CUÁL pulsó, que es evidencia y no un veredicto.
   *
   * Sólo tiene sentido cuando los elementos están cableados IGUAL — que es
   * justo lo que significa un `querySelectorAll` en el runtime del modelo.
   */
  readonly cualquiera?: boolean;
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
  | {
      readonly kind: "error";
      readonly reason: SpecRechazo;
      readonly paso?: number;
      /** Las claves que el modelo mandó y que no existen, con su ruta
       *  (`prueba[0].click`). Sólo cuando hay alguna. Ver `clavesDesconocidas`. */
      readonly desconocidas?: readonly string[];
    };

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
 * `…` y `#drink-list .drink-card:nth-child(3)`—. La
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
 * `querySelectorAll(sel).length`, dentro del helper `…` de `specProgram`.
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

/** El NOMBRE de un atributo HTML: `disabled`, `aria-expanded`, `data-estado`.
 *
 *  🔴 SE ACEPTA `class` a propósito, aunque `estilo` sea mejor verbo para lo
 *  que la clase provoca. Rechazarlo aquí tiraría la prueba ENTERA —este
 *  validador rechaza entero, nunca a medias— y volveríamos a subir el número
 *  que B acababa de bajar (descartadas en la puerta 4 → 1). La preferencia se
 *  dice donde se puede leer, que es el prompt; no se impone con una puerta que
 *  el modelo no ve. Misma lección que la regex de selectores: contra una regla
 *  que no se puede leer, el modelo no puede ganar. */
const NOMBRE_ATRIBUTO_OK = /^[a-z][a-z0-9-]{0,38}$/;

function nombreAtributoValido(s: unknown): s is string {
  return typeof s === "string" && NOMBRE_ATRIBUTO_OK.test(s.trim());
}

/**
 * Valida lo que el modelo emitió. Rechaza entero, nunca a medias: una spec con
 * un paso bueno y uno inválido probaría la mitad de la promesa y diría que
 * pasó — que es peor que no probar.
 */
export function parseBehaviorSpec(raw: unknown): SpecResultado {
  const r = analizarSpec(raw);
  if (r.kind !== "error") return r;
  // Un rechazo NOMBRA las claves que sobran — la forma de Claude Code:
  // «…». Sólo en el rechazo: una
  // clave de más en una prueba que sí se puede correr no la tira.
  const desconocidas = clavesDesconocidas(raw);
  return desconocidas.length > 0 ? { ...r, desconocidas } : r;
}

const CLAVES_PASO = new Set(["clic", "desplaza", "veces", "escribe", "entonces", "cualquiera"]);
const CLAVES_EXPECTATIVA = new Set(["donde", "que", "valor"]);

/** Las claves que no existen, con su ruta: `prueba[0].click`,
 *  `prueba[1].entonces[0].esperado`. Sin ellas, un modelo que escribió `click`
 *  por `clic` leía «NINGÚN paso pulsa ni escribe» creyendo que pulsaba. */
export function clavesDesconocidas(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const fuera: string[] = [];
  raw.forEach((p, i) => {
    if (!p || typeof p !== "object") return;
    for (const k of Object.keys(p)) if (!CLAVES_PASO.has(k)) fuera.push(`prueba[${i}].${k}`);
    const entonces = (p as Record<string, unknown>).entonces;
    if (!Array.isArray(entonces)) return;
    entonces.forEach((e, j) => {
      if (!e || typeof e !== "object") return;
      for (const k of Object.keys(e)) {
        if (!CLAVES_EXPECTATIVA.has(k)) fuera.push(`prueba[${i}].entonces[${j}].${k}`);
      }
    });
  });
  return fuera;
}

/** La FORMA de lo que llegó, sin los valores, para el log: `[{click,entonces[2]}]`.
 *  El motivo del rechazo dice QUÉ regla saltó; esto dice qué mandó el modelo,
 *  que es lo que hace falta para saber si la culpa es suya o del prompt. */
export function formaDePrueba(raw: unknown): string {
  if (typeof raw === "string") return `string(${raw.length})`;
  if (!Array.isArray(raw)) return raw === null ? "null" : typeof raw;
  const paso = (p: unknown): string => {
    if (!p || typeof p !== "object") return typeof p;
    const claves = Object.entries(p as Record<string, unknown>).map(([k, v]) =>
      Array.isArray(v) ? `${k}[${v.length}]` : k,
    );
    return `{${claves.join(",")}}`;
  };
  return `[${raw.map(paso).join(",")}]`;
}

function analizarSpec(raw: unknown): SpecResultado {
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
    // Mismo trato que `clic`: se valida AQUÍ, donde todavía se puede decir por
    // qué, y no en el navegador, donde un selector malo sale como «no cambió» y
    // acusaría a la página de un fallo que es de la prueba.
    const desplaza = typeof p.desplaza === "string" ? p.desplaza.trim() : undefined;
    if (desplaza !== undefined && !selectorValido(desplaza)) {
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
        que !== "visible" && que !== "oculto" && que !== "estilo" &&
        que !== "atributo"
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
      // Y `atributo` pide el nombre de un ATRIBUTO, por el mismo motivo: un
      // nombre inventado sale `null` en las dos medidas y eso se leería como
      // «no cambió» — la prueba acusaría a la página de un fallo que es del
      // nombre. Se comprueba aquí, donde todavía se puede decir por qué.
      if (que === "atributo" && !nombreAtributoValido(e.valor)) {
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
      ...(desplaza ? { desplaza } : {}),
      // Sólo cuando hay algo que desambiguar: un `cualquiera` colgado de un
      // paso que no actúa no significa nada y ensuciaría `formaDePrueba`.
      ...((clic || desplaza) && p.cualquiera === true ? { cualquiera: true } : {}),
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
  // `desplaza` CUENTA COMO ACCIÓN, y es lo que hace satisfacible la regla para
  // una conducta que se dispara sola. Ver el bloque de `PasoSpec.desplaza`:
  // medido el 2026-09-21, un contador por visibilidad no cablea ni un clic.
  if (
    !pasos.some(
      (p) => p.clic !== undefined || p.escribe !== undefined || p.desplaza !== undefined,
    )
  ) {
    return { kind: "error", reason: "sin_accion" };
  }
  return { kind: "spec", pasos };
}

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
  /** De QUÉ promesa es, cuando el programa corre varias (`programaSuiteJs`):
   *  0 es la primera. Es lo que deja repartir sin cortar por número de paso. */
  readonly programa?: number;
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
/**
 * EL CENSO DE MANEJADORES DE CLIC — se instala ANTES de que la página cargue.
 *
 * 🔴 POR QUÉ EXISTE. `specProgram` no comprobaba causalidad: tomaba una foto,
 * actuaba, y daba por cumplida la promesa si algo se movía dentro de la
 * ventana — sin mirar QUIÉN lo movió. MEDIDO en Chromium con brazo de control
 * (`behavior-spec.test.ts`): un clic sobre un botón MUERTO cumple la promesa si
 * un contador se anima solo, y el mismo botón sin animación falla. O sea, el
 * clic era decorativo y la prueba pasaba sin probar nada.
 *
 * LA FORMA DEL ARREGLO NO ES MEDIR DOS VECES, es que la acción falle antes. Es
 * lo que hace Claude Code, provocado en su propio arnés: un `Edit` con
 * `old_string === new_string` devuelve «No changes to make: old_string and
 * new_string are exactly the same» y no toca el fichero; y su contrato dice
 * «…». La acción reporta su propio efecto.
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
  // antes que los guardias de specProgram, que se instalan después del censo.
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
 * @param propias Cuántos pasos del principio son la promesa DE ESTE TURNO. Los
 *   de detrás son promesas GUARDADAS, y a ésas no se les aplica la precondición
 *   del clic muerto.
 *
 *   🔴 LA DISTINCIÓN CUESTA CARO SI SE PIERDE, y casi se pierde: una guardada
 *   se verificó CUMPLIÉNDOSE el día que se guardó, así que si hoy su clic no
 *   tiene manejador, el que cambió es la PÁGINA — es la regresión más valiosa
 *   que mide el repo (el turno que reescribe el runtime y se deja por el camino
 *   el manejador de `#agregar`: la página no explota, la foto sale idéntica y
 *   la consola está limpia). Tratarla como fallo del instrumento no sólo la
 *   callaría: `retirarPruebas` BORRARÍA la promesa, y el carrito roto no se
 *   volvería a cazar nunca. Lo cazó `suite-de-la-pagina.browser.test.ts`.
 *
 *   Para la promesa del turno no hay historial —el modelo acaba de escribirla—
 *   así que ahí un clic muerto sí es instrumento, no página.
 */
export function specProgram(
  pasos: readonly PasoSpec[],
  propias: number = pasos.length,
): string {
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
  // ⚠️ SE INSTALAN MÁS ABAJO, DESPUÉS DEL CENSO. Este guardia es un listener de
  // clic en \`document\`, así que censar con él puesto marcaría VIVO a cualquier
  // botón de cualquier página. MEDIDO: censo antes = 0, censo después = 1 sobre
  // el mismo botón muerto. Mover esto arriba vuelve a apagar la precondición
  // entera sin que ninguna prueba se ponga roja.

  // ¿ESTE SELECTOR SEÑALA UN ELEMENTO? Se CUENTA en el navegador, no se
  // adivina con una expresión regular en el servidor — es la misma regla que
  // usa el Edit de Claude Code («casa exactamente una vez o falla») y el mismo
  // principio que [[render-measured-contrast]]: si hay un navegador abierto,
  // se mide, no se deduce.
  //
  // Devuelve \`{el}\` o \`{err}\`. Un \`err\` de aquí NO es un fallo de la página:
  // es una prueba que no se puede aplicar, y se marca como tal.
  // 🔴 Y SI NO ES UN SELECTOR, SE BUSCA POR SU NOMBRE — la forma del \`find\` de
  // Claude Code: «elementos cuya línea del árbol de accesibilidad (rol/nombre/
  // texto) contiene la consulta». Allí NUNCA se le pide al modelo un selector
  // único: o el sistema reparte identidad (\`ref_N\` de \`read_page\`) o el
  // elemento se nombra por su texto.
  //
  // MEDIDO el 2026-09-19 sobre el carrito que escribe el modelo de verdad:
  // \`document.querySelectorAll('.btn-add')\` para los tres botones de añadir, y
  // \`document.createElement('button')\` para «−», «+» y «Quitar» — cuatro de los
  // cinco manejadores viven en elementos que NO tienen id y que ni siquiera
  // existen en el documento guardado. Exigir un \`#id\` único era exigir algo que
  // la página no tiene; su texto, en cambio, lo tienen todos.
  var PULSABLES = 'button, [role="button"], a, summary, input[type="button"], input[type="submit"], [onclick]';
  var nombreDe = function (el) {
    var n = el.getAttribute("aria-label") || el.value || el.textContent || el.title || "";
    return String(n).replace(/\\s+/g, " ").trim().toLowerCase();
  };
  var porNombre = function (q) {
    var busca = String(q).replace(/\\s+/g, " ").trim().toLowerCase();
    if (!busca) return { err: "no hay nada que buscar" };
    var todos = Array.prototype.slice.call(document.querySelectorAll(PULSABLES));
    var casan = todos.filter(function (el) { return nombreDe(el).indexOf(busca) !== -1; });
    // Entre varios, los que SE VEN: un botón oculto con el mismo texto es el
    // falso positivo natural aquí (menús, plantillas de fila).
    if (casan.length > 1) {
      var visibles = casan.filter(seVe);
      if (visibles.length === 1) return { el: visibles[0] };
      return { err: "«" + q + "» señala " + casan.length + " elementos pulsables, no uno" };
    }
    if (casan.length === 0) return { err: "ni existe el selector " + q + " ni hay nada pulsable que se llame así" };
    return { el: casan[0] };
  };

  var uno = function (sel) {
    var els = null;
    try { els = document.querySelectorAll(sel); }
    catch (e) { return porNombre(sel); }
    if (els.length === 0) return porNombre(sel);
    if (els.length > 1) {
      // 🔴 LAS DOS SALIDAS, NO SÓLO EL DIAGNÓSTICO. Un objetivo ambiguo no se
      // resuelve eligiendo: no se toca nada, se dice que es ambiguo y se nombran
      // LAS DOS maneras de salir —afinar, o declarar que da igual—. Decir sólo
      // «señala 3» deja al modelo con un problema y sin ninguna salida.
      return {
        err:
          sel + " señala " + els.length + " elementos, no uno" +
          " — afina el selector, o pon \\"cualquiera\\": true en este paso si da igual" +
          " cuál de los " + els.length + " se pulse porque los cableaste iguales",
      };
    }
    return { el: els[0] };
  };

  // EL GRUPO, DECLARADO: no desambigua sola —eso sería elegir un objetivo—, lo
  // hace porque el PASO dice que da igual. Y devuelve CUÁL pulsó, que es la
  // evidencia sin la que el resultado no se puede leer.
  var delGrupo = function (sel) {
    var els = null;
    try { els = document.querySelectorAll(sel); }
    catch (e) { return porNombre(sel); }
    if (els.length === 0) return porNombre(sel);
    var lista = Array.prototype.slice.call(els);
    var visibles = lista.filter(seVe);
    var el = visibles.length > 0 ? visibles[0] : lista[0];
    return { el: el, de: lista.length, nombre: texto(el).slice(0, 40) };
  };
  var actuar = function (sel, cualquiera) {
    return cualquiera ? delGrupo(sel) : uno(sel);
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

  // El atributo TAL CUAL, con \`null\` cuando no está. La ausencia es un estado
  // de pleno derecho —\`disabled\` se quita, no se pone a ""— y confundirla con
  // la cadena vacía haría invisible justo el cambio que se quiere ver: un
  // \`disabled\` presente se lee "" en HTML.
  var atributoDe = function (el, nombre) {
    return el.hasAttribute(nombre) ? el.getAttribute(nombre) : null;
  };

  // ¿Esta expectativa YA se cumplía con el estado de ANTES de actuar?
  //
  // Sólo pueden serlo las ABSOLUTAS. \`cambia\`, \`estilo\` y \`atributo\` se miden
  // CONTRA la foto previa, así que por definición no pueden cumplirse antes:
  // preguntárselo sería siempre \`false\` y confundiría a quien lea esto.
  var yaSeCumplia = function (exp, antes, antesVe) {
    var previo = antes[exp.donde];
    if (exp.que === "contiene") {
      return typeof previo === "string" &&
        previo.toLowerCase().indexOf(String(exp.valor).toLowerCase()) !== -1;
    }
    if (exp.que === "es") return previo === String(exp.valor);
    // \`undefined\` = el elemento no existía antes, y eso NO es vacuo: que
    // aparezca es justo lo que la acción tenía que provocar.
    if (exp.que === "visible") return antesVe[exp.donde] === true;
    if (exp.que === "oculto") return antesVe[exp.donde] === false;
    return false;
  };

  // El mensaje del fallo, o null si la expectativa se cumple EN ESTE INSTANTE.
  var comprueba = function (exp, antes, antesEstilo, antesAttr) {
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
    } else if (exp.que === "atributo") {
      var nom = String(exp.valor);
      var antesA = antesAttr[exp.donde + "|" + nom];
      var ahoraA = atributoDe(el, nom);
      if (antesA === undefined) antesA = null;
      // Ausente en las DOS medidas: o el nombre no es el que el elemento
      // lleva, o se está mirando al elemento equivocado. Decirlo así —y no
      // "no cambió"— es lo que separa que corrija el nombre de que se ponga a
      // reescribir un script que está bien. Misma disciplina que \`estilo\`.
      if (antesA === null && ahoraA === null) {
        return exp.donde + " no tiene el atributo " + nom + " ni antes ni después (¿es ése su nombre, y ése el elemento?)";
      }
      if (antesA === ahoraA) {
        return exp.donde + " no cambió su atributo " + nom +
          (ahoraA === null ? " (sigue sin tenerlo)" : ' (sigue en "' + String(ahoraA).slice(0, 40) + '")');
      }
    }
    return null;
  };

  // ─── EL CENSO, Y LUEGO LOS GUARDIAS. EN ESE ORDEN. ───────────────────────
  //
  // ¿Puede este clic hacer algo? Se mira la cadena ENTERA —el elemento, sus
  // ancestros, \`document\` y \`window\`— porque la delegación es la forma que más
  // usa el modelo: medido en el carrito, 4 de 5 manejadores viven en elementos
  // sin id creados al vuelo, y censar sólo el elemento los daría por muertos.
  //
  // 🔴 SÓLO DISPARA CON LA CADENA ENTERA A CERO. Esa asimetría es lo que lo
  // deja incapaz de acusar en falso, a cambio de dejar pasar dudosos —que es
  // exactamente lo que ya pasaba antes de existir.
  var REGISTRO = (typeof window !== "undefined" && window.__olCensoClic) || null;
  var tieneManejador = function (el) {
    for (var e = el; e; e = e.parentElement) {
      if (REGISTRO.has(e)) return true;
      if (typeof e.onclick === "function") return true;
    }
    if (REGISTRO.has(document) || typeof document.onclick === "function") return true;
    if (REGISTRO.has(window) || typeof window.onclick === "function") return true;
    return false;
  };
  var MUERTOS = {};
  // FAIL-OPEN: sin registro no se censa nada y no se acusa a nadie. Pasa en
  // cualquier renderizador que no instale el preludio, y con \`setContent\`.
  if (REGISTRO) {
    // Sólo los pasos PROPIOS: ver el parámetro \`propias\` de specProgram.
    for (var ci = 0; ci < ${JSON.stringify(propias)}; ci++) {
      if (!pasos[ci].clic) continue;
      var rc0 = actuar(pasos[ci].clic, pasos[ci].cualquiera);
      // Un selector que no resuelve ya lo dirá su propio paso, con su mensaje.
      if (rc0.err) continue;
      if (!tieneManejador(rc0.el)) MUERTOS[ci] = true;
    }
  }

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("button,input") : null;
    if (t && t.form && t.type === "submit") return;
    e.preventDefault();
  }, true);
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);

  for (var i = 0; i < pasos.length; i++) {
    var p = pasos[i];
    // ANTES: se guarda el texto de cada objetivo para poder decir si "cambia",
    // y el valor calculado de cada propiedad que mire un "estilo".
    var antes = {};
    var antesEstilo = {};
    var antesAttr = {};
    // Si se VEÍA antes, para poder decir que un \`visible\` ya se cumplía.
    var antesVe = {};
    for (var a = 0; a < p.entonces.length; a++) {
      var d = p.entonces[a].donde;
      // Por \`uno()\` y no por \`querySelector\` a pelo: un selector que no es CSS
      // válido LANZA, y aquí estamos FUERA del try — reventaba la medición
      // entera con un error que no tiene nada que ver con la página. Lo cazó su
      // propia prueba de navegador al escribirla.
      var e0 = uno(d).el || null;
      antes[d] = e0 ? texto(e0) : null;
      if (e0) antesVe[d] = seVe(e0);
      if (p.entonces[a].que === "estilo") {
        antesEstilo[d + "|" + p.entonces[a].valor] = e0 ? estiloDe(e0, String(p.entonces[a].valor)) : "";
      }
      // \`null\` cuando el elemento no existía todavía: no tenerlo y no estar
      // son la misma cosa para el atributo, y es la lectura que deja que
      // "aparece un panel con aria-expanded" cuente como cambio.
      if (p.entonces[a].que === "atributo") {
        antesAttr[d + "|" + p.entonces[a].valor] = e0 ? atributoDe(e0, String(p.entonces[a].valor)) : null;
      }
    }

    try {
      // DESPLAZAR VA PRIMERO del paso: es lo que hace que la conducta ARRANQUE
      // —un IntersectionObserver no se dispara hasta que el elemento entra en el
      // viewport— así que escribir o pulsar antes seria actuar sobre algo que
      // todavia no se ha puesto en marcha. Ver PasoSpec.desplaza.
      //
      // scrollIntoView SIN behavior smooth a proposito: el suave es asincrono y
      // tarda lo que el navegador quiera, asi que la ventana de espera se
      // gastaria midiendo un scroll en vez de la promesa. El salto instantaneo
      // dispara el observer en el frame siguiente, que la ventana ya cubre.
      if (p.desplaza) {
        var rd = actuar(p.desplaza, p.cualquiera);
        // Igual que clic y escribe: un selector que no resuelve es fallo DE LA
        // PRUEBA y no acusa a la pagina.
        if (rd.err) { fallos.push([i, rd.err, "prueba"]); continue; }
        rd.el.scrollIntoView({ block: "center", inline: "nearest" });
      }
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
        var rb = actuar(p.clic, p.cualquiera);
        if (rb.err) {
          fallos.push([i, rb.err, "prueba"]);
          continue;
        }
        // LA PRECONDICIÓN, dicha ANTES de actuar. El HECHO contado —no un
        // veredicto—, ni una palabra sobre la página, y el arreglo nombrado y
        // ramificado por intención con el selector ya puesto. Es la anatomía
        // del «No changes to make: old_string and new_string are exactly the
        // same» del Edit, que tampoco ejecuta para luego mirar si sirvió.
        if (MUERTOS[i]) {
          // ⚠️ EL ARREGLO VA DELANTE, y no es estilo: \`leerFallos\` recorta a 200
          // caracteres, así que lo que se ponga al final es lo que desaparece
          // con un selector largo. Ya se comió el \`desplaza\` una vez. Y de paso
          // es lo que pedía la tarea 3.4 — nombrarlo pronto, no en el carácter
          // 362 de una frase que antes dice dos veces «dale a alguno un clic».
          var aVer = (p.entonces[0] && p.entonces[0].donde) || p.clic;
          fallos.push([
            i,
            // ⚠️ EL REGISTRO ES DE ELLOS, NO NUESTRO: sus mensajes de
            // herramienta van de 62 a 212 caracteres (mediana ~100) y NO llevan una sola
            // mayúscula enfática — son declarativas planas. Este mensaje tenía
            // ~350 y un «AL VERSE» que es hábito de esta casa. Lo que se copia
            // es su forma, no nuestras costumbres con su estructura encima.
            p.clic + ' no tiene manejador de clic. ' +
              'Si se dispara al verse, usa desplaza:"' + aVer + '". ' +
              'Si al pulsar, engánchale uno. ' +
              // EL ALCANCE VA EN LA NOTA, no en el hecho — que es la forma del
              // «String to replace not found in file.» rematado con su nota.
              //
              // ⚠️ La nota enumera lo que el censo MIRA DE VERDAD. Se quitó
              // window de ella para ganar 8 caracteres y eso la volvía FALSA: una
              // nota que miente es peor que una larga, porque manda a buscar
              // justo donde ya se buscó. Se recortó la otra mitad.
              '(note: se miraron addEventListener("click") y onclick en el ' +
              'elemento, sus ancestros, document y window.)',
            "prueba",
          ]);
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

    // ¿DISCRIMINA ESTE PASO? Una expectativa que YA se cumplía antes de actuar
    // no puede decir nada de la acción. MEDIDO en pago el 2026-09-21:
    // contador-se-construye salió verde pulsando el propio contador y
    // comprobando que contuviera "5,000" —lo que el contador alcanza solo—.
    //
    // 🔴 NO ES UN FALLO, Y VA POR SU PROPIO CANAL. Los graders de Claude Code
    // tienen tres estados (evaluated / skipped / unavailable con motivo) y el
    // que no pudo comprobar puntúa passed:false; eso vale para una puerta de
    // CI, no para el turno pagado de un usuario, donde acusar a una página sana
    // ya está medido en 0 de 5. Se copia que el estado SE VEA con su motivo, no
    // el veredicto.
    //
    // SÓLO EN PASOS QUE ACTÚAN: la regla del 2026-08-30 —un paso posterior
    // puede sólo comprobar el estado que dejó el anterior— se tomó midiendo que
    // rechazarlo tiraba 2 de cada 4 pruebas buenas.
    //
    // Viaja en la MISMA lista con su propia marca, como \`"prueba"\`: cambiar la
    // forma de lo que devuelve el programa rompería a \`leerFallos\`, que ya la
    // leen cuatro sitios. \`leerFallos\` las filtra; \`leerVacuas\` las recoge.
    if (p.clic || p.escribe || p.desplaza) {
      for (var vq = 0; vq < p.entonces.length; vq++) {
        if (yaSeCumplia(p.entonces[vq], antes, antesVe)) {
          fallos.push([i, p.entonces[vq].donde + " ya se cumplía antes de actuar, así que este paso no comprueba la acción", "vacua"]);
        }
      }
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
        var m = comprueba(p.entonces[k], antes, antesEstilo, antesAttr);
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
/**
 * Cuánto se guarda de un mensaje que llega DEL NAVEGADOR. Acotar hace falta —la
 * cadena la compone el programa y no queremos una página metiendo un megabyte
 * en el turno— pero el tope no puede ser tan corto que MUTILE lo que el mensaje
 * nombra.
 *
 * 🔴 ERA 200, Y MENTÍA. `selectorValido` acepta hasta 80 caracteres, así que un
 * mensaje que cita dos selectores no cabía: lo que se perdía era la cola, que
 * es donde va el arreglo (`desplaza:"…"`). Recortar el selector DENTRO del
 * arreglo es peor todavía —le da al modelo un selector que no existe—, y un
 * mensaje que miente es peor que uno largo: es la doctrina de degradación.
 *
 * 400 deja sitio al peor caso que el validador admite (80 + 80 + la frase) con
 * margen, y sigue acotado. La TARJETA no depende de esto: la acota aparte
 * `TOPE_MOTIVO`, en `motivo-del-fallo.ts`.
 */
export const TOPE_MENSAJE = 400;

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
    // 🔴 LAS VACUAS NO SON FALLOS Y SE FILTRAN AQUÍ. Si se colaran, todo el
    // que hace `f.deLaPrueba !== true` —`promesaIncumplida`, `repartirFallos`,
    // `notaSpec`— las leería como «la página no cumplió» y acusaría a una
    // página sana por una prueba floja del modelo. Las recoge `leerVacuas`.
    if (f[2] === "vacua") continue;
    // Y LO QUE NO LLEGÓ A CORRER tampoco es un fallo: ver `leerSinCorrer`.
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
 * LAS EXPECTATIVAS QUE NO PODÍAN PROBAR NADA — el tercer canal.
 *
 * Una expectativa absoluta (`contiene`, `es`, `visible`, `oculto`) que YA se
 * cumplía antes de actuar no dice nada de la acción: el paso sale verde pase lo
 * que pase. MEDIDO en pago el 2026-09-21 sobre `contador-se-construye`.
 *
 * 🔴 NO ACUSA A NADIE, y por eso viaja aparte en vez de en `fallos`. Es la
 * forma de las evals de Claude Code —lo que no se pudo comprobar se dice, con
 * el motivo dentro— menos su veredicto: allí lo que no pudo comprobar no
 * aprueba, y eso es correcto para una puerta de CI y falso para el turno
 * pagado de un usuario, donde acusar a una página sana está medido en 0 de 5.
 *
 * Quien decide qué hacer con esto es quien lee: la batería puede suspender,
 * el turno del usuario no.
 */
export function leerVacuas(bruto: unknown): FalloSpec[] {
  if (!Array.isArray(bruto)) return [];
  const out: FalloSpec[] = [];
  for (const f of bruto) {
    if (!Array.isArray(f) || f.length < 3 || f[2] !== "vacua") continue;
    const paso = Number(f[0]);
    const mensaje = String(f[1]);
    if (Number.isFinite(paso) && mensaje) {
      out.push({ paso: paso + 1, mensaje: mensaje.slice(0, TOPE_MENSAJE) });
    }
  }
  return out;
}

const listarFallos = (fs: readonly FalloSpec[]): string =>
  fs.slice(0, 4).map((f) => `paso ${f.paso}: ${f.mensaje}`).join(" · ");

/**
 * LAS DOS POBLACIONES DE UN FALLO, QUE NO SE MEZCLAN.
 *
 * `deLaPrueba` lo pone `leerFallos` desde que existe (ver `FalloSpec`), y hasta
 * hoy su ÚNICO consumidor era el `break` que evita reintentar. Las dos frases
 * que salen de aquí —la del usuario y la del modelo— lo ignoraban, así que un
 * fallo DEL INSTRUMENTO se contaba como un fallo DE LA PÁGINA en los dos
 * canales, y en el del modelo además disparaba una reescritura del runtime.
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

/** El aviso PARA EL MODELO. Nombra el paso y el elemento — sin eso, «no
 *  funciona» le manda a mirar al sitio equivocado. */
export function avisoSpec(fallos: readonly FalloSpec[]): string {
  const { pagina, prueba } = partirFallos(fallos);

  // EL INSTRUMENTO, NO LA PÁGINA — y aquí duele el doble, porque este canal SÍ
  // sigue dentro de un bucle que edita (`ai-design`). Mandar `target="runtime"`
  // por un selector que no resuelve es mandar a reescribir código que funciona.
  // El arreglo va nombrado por la propiedad (3): sin él se reintenta a ciegas,
  // medido el 2026-08-30 —cinco vueltas y `turn_limit` agotado sin acertar una.
  if (pagina.length === 0) {
    return `TU PRUEBA NO LLEGÓ A CORRER — ${listarFallos(prueba)}. Es un fallo DE LA PRUEBA, no de la página: NO toques el runtime, que corrió bien. Reescribe sólo el selector para que señale UN elemento — un id (#algo) del documento que acabas de guardar, o el elemento concreto en vez de la colección.`;
  }

  const base = `TU PROPIA PRUEBA FALLÓ al ejecutarla en un navegador de verdad — ${listarFallos(pagina)}. La página carga sin errores, así que esto NO es un fallo de sintaxis: el código corre y hace algo distinto de lo que prometiste. Arréglalo AHORA con un edit target="runtime" que lleve el script COMPLETO corregido, y NO le digas al usuario que funciona hasta que la prueba pase.`;
  if (prueba.length === 0) return base;
  return `${base} Aparte, ${listarFallos(prueba)} — eso es la prueba y no la página: ahí arregla el selector, no el runtime.`;
}

/**
 * LO MISMO, DICHO COMO NOTA Y NO COMO ACUSACIÓN.
 *
 * 🔴 POR QUÉ HAY DOS. `avisoSpec` le habla al MODELO dentro de un bucle que
 * puede arreglarlo — «arréglalo AHORA con un edit target="runtime"»— y nació
 * cuando ese bucle existía. En el Agente ese ciclo se retiró el 2026-09-04, y
 * al retirarlo la lista de `issues` dejó de ser un canal hacia el modelo y pasó
 * a ser el texto que el bucle le EMITE AL USUARIO. O sea que el dueño de la
 * página estaba leyendo una orden escrita para un modelo, con el nombre de una
 * herramienta interna dentro.
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

/** Frase para el USUARIO cuando la spec venía mal formada. La página NO se
 *  reprueba por esto: una prueba que no se pudo correr no acusa a nadie. */
export function specRechazoAviso(
  reason: SpecRechazo,
  paso?: number,
  desconocidas?: readonly string[],
): string {
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
      // 🔴 EL ORDEN ES EL ARREGLO, y costó medirlo. Este aviso nombraba
      // `desplaza` — pero en el carácter 362 de 456, después de decir DOS veces
      // «dale a alguno un clic». El modelo lo leyó entero y mandó `clic`. Lo
      // que se dice primero es lo que se usa, así que va primero la salida de
      // la familia que NO PUEDE pulsar (no tiene nada que pulsar: ésa era la
      // regla insatisfacible) y después la de siempre.
      // 🔴 Y NOMBRA LA SALIDA QUE LA PÁGINA SÍ TIENE. MEDIDO por ssh el
      // 2026-09-21: de los 4 proyectos que salieron `sin_accion` en
      // producción, TRES cablean sus botones con `createElement` y no tienen
      // id —`…` sobre un botón sin id, leído en
      // la página de un usuario—. Este aviso les decía `clic:"#selector"`: le
      // señalábamos al modelo justo lo que su página no tiene. El navegador ya
      // resuelve por texto (`porNombre`); faltaba decirlo donde hace falta.
      'NINGÚN paso actúa: así se comprueba el HTML, no el comportamiento. Si tu conducta se dispara AL VERSE —un contador con IntersectionObserver, un revelado al bajar— su acción es `desplaza:"#selector"`: lleva el elemento al viewport y eso la arranca. Si se dispara al pulsar o al escribir, dale a algún paso un `clic` o un `escribe:{"#campo":"valor"}` — puede ser cualquiera, no hace falta que sea el primero. Y si el botón NO tiene id —porque lo creas con createElement o lo cableas por clase— nómbralo por su TEXTO: `clic:"Añadir al carrito"`, que es como lo encontraría una persona. Y si lo que cableaste no cabe en pulsar/escribir/desplazar, no lo fuerces: mándalo como programa en `prueba_js`',
  };
  const delPaso: Partial<Record<SpecRechazo, string>> = {
    paso_invalido:
      "no tiene la forma de un paso. Un paso es un objeto con `clic` y/o `escribe` y su `entonces`",
    sin_expectativa:
      'no dice qué debía pasar después. Añádele `entonces:[{donde:"#selector", que:"cambia"|"contiene"|"es"|"visible"|"oculto"|"estilo"|"atributo"}]`',
    selector_invalido:
      "lleva un selector que no es válido o apunta a varios elementos. Usa un id (#algo) que exista en el documento que acabas de guardar",
    falta_valor:
      'usa `que:"contiene"`, `que:"es"`, `que:"estilo"` o `que:"atributo"` sin un `valor` bueno. Las dos primeras comparan contra un TEXTO: añádeselo. `estilo` quiere el NOMBRE de una propiedad CSS —`background-color`, `text-decoration`, `--ol-bg`—, no su valor: el navegador serializa los colores a su manera y adivinar cómo no es tu trabajo. `atributo` quiere el NOMBRE de un atributo HTML —`disabled`, `aria-expanded`, `checked`—, y comprueba que CAMBIE: para eso está, para el estado que no se ve en el texto',
  };
  const frase =
    deLaLista[reason] ?? `${paso ? `el paso ${paso}` : "un paso"} ${delPaso[reason]}`;
  const sobran =
    desconocidas && desconocidas.length > 0
      ? ` Y trae claves que no existen: ${desconocidas.map((d) => `\`${d}\``).join(", ")}. ` +
        "Las de un paso son clic, veces, escribe y entonces; las de una expectativa, donde, que y valor."
      : "";
  return `${HECHO_SIN_COMPROBAR}: ${frase}.${sobran} El cambio sí se guardó.`;
}

/**
 * EL HECHO, uno solo, compartido por las dos frases.
 *
 * 🔴 La regla de siempre —dos redacciones del mismo suceso son dos verdades y
 * una miente— se cumple AQUÍ: lo ocurrido lo dice esta constante y nadie más.
 * Lo que cambia entre el modelo y el dueño no es qué pasó, es quién tiene que
 * mover ficha, y eso es otra cosa.
 */
export const HECHO_SIN_COMPROBAR = "No pude comprobar el comportamiento";

/**
 * LO QUE LEE EL DUEÑO EN LA TARJETA ÁMBAR.
 *
 * La otra frase —`specRechazoAviso`— es la receta del modelo: qué clave venía
 * mal y cómo mandarla bien. Al dueño eso no le sirve, porque él no manda
 * pruebas; lo que necesita saber es que NADIE comprobó su página y que le toca
 * a él mirarlo.
 *
 * LA VARA, vista en Claude Code el 2026-09-18: cuando allí no se puede observar
 * si algo ocurrió, no dicen «hecho» ni «falló» — dicen NO CONFIRMADO, nombran
 * qué se ignora y dicen qué hacer: «…» Las tres piezas, y la tercera cambia
 * según quién lee.
 *
 * No lleva el motivo técnico a propósito: `sin_accion` o `selector_invalido` no
 * le dicen nada a quien acaba de pedir un carrito, y el motivo entero sigue en
 * el diario del turno y en el log.
 */
export function avisoParaLaTarjeta(): string {
  return `${HECHO_SIN_COMPROBAR}: el cambio se guardó, pero nadie pulsó la página para verlo. Pruébalo tú antes de publicar.`;
}

/** Ids que el código cablea a un clic, y el hueco donde buscarlos alrededor de
 *  cada `"click"`. 200 caracteres cubre las tres formas que el modelo escribe
 *  —directa, con variable de por medio, y delegada— sin cruzar a la siguiente
 *  función, que es donde empezarían los falsos positivos. */
const VENTANA_CLIC = 200;
const ID_EN_SELECTOR = /(?:getElementById\(\s*["']([^"']+)["']|querySelector(?:All)?\(\s*["']#([^"'\s>.[]+)|closest\(\s*["']#([^"'\s>.[]+))/g;

/**
 * EL ELEMENTO QUE EL PROPIO CÓDIGO DEL MODELO CABLEA A UN CLIC.
 *
 * 🔴 POR QUÉ EXISTE, con tres medidas y no con una idea: `sin_accion` —una
 * promesa cuyos pasos sólo MIRAN— salió el 17/09 en casi todas las vueltas del
 * carrito, el 18/09 en producción, y el 19/09 en la corrida de dos turnos del
 * escenario `carrito`, donde el contador dijo `sigue_mal`: el modelo recibió el
 * aviso con la corrección pegada y repitió la misma forma. La maquinaria que
 * consume la promesa funciona; el modelo no la alimenta.
 *
 * LA VARA ES CLAUDE CODE: allí una entrada que no valida se intenta
 * REPARAR antes de juzgarla, y sólo si sigue mal se devuelve el error con su
 * steer. Aquí la reparación no inventa nada — el JavaScript que el modelo acaba
 * de escribir dice qué elemento responde a un clic. Se lee su propio código.
 *
 * `evitar` son los selectores que la promesa ya vigila: pulsar lo que se mira
 * comprobaría que un elemento se cambia a sí mismo, que pasa siempre o nunca.
 *
 * `null` cuando no hay nada que pulsar, y eso es la mitad del valor: devolver
 * un selector a ciegas convertiría una promesa mal escrita en una promesa
 * FALSA — entraría en la suite y acusaría a la página desde dentro.
 */
export function derivarClic(runtime: string, evitar: readonly string[] = []): string | null {
  if (!runtime) return null;
  const prohibidos = new Set(evitar.map((s) => s.trim()));
  for (const m of runtime.matchAll(/["']click["']/g)) {
    const desde = Math.max(0, m.index - VENTANA_CLIC);
    // Antes del listener primero (la forma directa y la de la variable), y
    // detrás después (la delegada, donde el id vive dentro del manejador).
    const antes = runtime.slice(desde, m.index);
    const despues = runtime.slice(m.index, m.index + VENTANA_CLIC);
    for (const trozo of [antes, despues]) {
      const ids = [...trozo.matchAll(ID_EN_SELECTOR)]
        .map((x) => x[1] ?? x[2] ?? x[3])
        .filter((x): x is string => Boolean(x));
      // En el trozo de ANTES gana el último (el más pegado al listener); en el
      // de DESPUÉS, el primero, por la misma razón.
      const orden = trozo === antes ? ids.reverse() : ids;
      for (const id of orden) {
        const selector = `#${id}`;
        if (!prohibidos.has(selector)) return selector;
      }
    }
  }
  return null;
}

/**
 * LA PROMESA SIN ACCIÓN, REPARADA — o `null` si no se puede.
 *
 * Le pone el clic derivado al PRIMER paso: es donde la promesa empieza, y los
 * posteriores pueden sólo mirar (esa regla se invirtió el 2026-08-30 tras medir
 * que el modelo escribe «muestra 0» y luego «pulso +, muestra 1»).
 *
 * `null` también cuando la promesa YA pulsa: reparar lo que no está roto es
 * cómo se rompe algo que funcionaba.
 */
/** ¿Este runtime se dispara AL VERSE? Es lo que hace que la acción correcta sea
 *  `desplaza` y no un clic — y es justo la familia para la que `sin_accion` era
 *  insatisfacible: un `IntersectionObserver` no cablea nada que pulsar. */
const DISPARA_AL_VERSE = /\bIntersectionObserver\b/;

/**
 * LA PROMESA SIN ACCIÓN, REPARADA HACIA `desplaza`. Hermana de
 * `conClicDerivado`, para el otro verbo.
 *
 * 🔴 POR QUÉ EXISTE, medido en corrida de pago el 2026-09-21 ($0,024). Caso
 * `contador-se-construye`, CON el aviso de `sin_accion` ya reordenado para
 * nombrar `desplaza` lo primero: el modelo mandó `[{entonces[1]}]` —sólo
 * mirar—, se le rechazó, y volvió a mandar `[{entonces[1]}]`. El diagnóstico
 * no era «falta decirlo» ni «está dicho en el sitio equivocado»: decirlo mejor
 * no lo arregla. Y la máquina ya tenía el dato — el log del reparador imprime
 * «0 listener(s) de clic», que ES la señal de que esto se dispara al verse.
 *
 * DE DÓNDE SALE EL SELECTOR: del `donde` que la propia promesa dice que va a
 * cambiar. No se parsea el `observe(...)` del runtime a propósito — el
 * elemento que se observa y el que cambia son el mismo en esta familia, y
 * leerlo de la promesa no puede señalar a algo que la promesa no mire.
 *
 * `null` en cuanto haya duda: si el runtime no observa el viewport, si la
 * promesa ya actúa, o si no hay un `donde` del que sacarlo. Una promesa falsa
 * es peor que una rechazada.
 */
export function conDesplazaDerivado(prueba: unknown, runtime: string): unknown | null {
  if (!DISPARA_AL_VERSE.test(runtime)) return null;
  if (!Array.isArray(prueba) || prueba.length === 0) return null;
  const pasos = prueba.filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
  if (pasos.length !== prueba.length) return null;
  // Si alguno ya actúa, esto no es `sin_accion` y no hay nada que reparar.
  if (
    pasos.some(
      (p) => p.clic !== undefined || p.escribe !== undefined || p.desplaza !== undefined,
    )
  ) {
    return null;
  }
  for (const paso of pasos) {
    const entonces = paso.entonces;
    if (!Array.isArray(entonces)) continue;
    for (const e of entonces) {
      const donde = e && typeof e === "object" ? (e as Record<string, unknown>).donde : undefined;
      if (typeof donde === "string" && donde.trim()) {
        // Al PRIMER paso, igual que `conClicDerivado`: es donde la promesa
        // empieza, y los posteriores pueden sólo mirar.
        return [{ ...pasos[0], desplaza: donde.trim() }, ...pasos.slice(1)];
      }
    }
  }
  return null;
}

export function conClicDerivado(prueba: unknown, runtime: string): unknown | null {
  if (!Array.isArray(prueba) || prueba.length === 0) return null;
  const pasos = prueba.filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
  if (pasos.length !== prueba.length) return null;
  // Si alguno actúa, esto no es `sin_accion` y no hay nada que reparar.
  if (pasos.some((p) => p.clic !== undefined || p.escribe !== undefined)) return null;

  const mirados: string[] = [];
  for (const paso of pasos) {
    const entonces = paso.entonces;
    if (!Array.isArray(entonces)) continue;
    for (const e of entonces) {
      const donde = (e as { donde?: unknown })?.donde;
      if (typeof donde === "string") mirados.push(donde);
    }
  }
  const clic = derivarClic(runtime, mirados);
  if (!clic) return null;
  return pasos.map((paso, i) => (i === 0 ? { ...paso, clic } : paso));
}

/** Los selectores que el MODELO pasó a `querySelector(All)` / `closest` /
 *  `matches` en su propio runtime, en orden de aparición. Es lo único que hay
 *  que promover en un runtime sin ids: lo escribió él, no lo elegimos nosotros. */
const SELECTOR_DEL_MODELO =
  /\b(?:querySelectorAll|querySelector|closest|matches)\s*\(\s*(["'])((?:(?!\1)[^\\\r\n]|\\.)+)\1\s*\)/g;

/**
 * ¿ES PROMOVIBLE ESTE SELECTOR? — y OJO: no juzga si es «pulsable».
 *
 * 🔴 AQUÍ VIVÍA UNA LISTA NEGRA DE CONTENEDORES (`div`, `span`, `li`…) que
 * decidía a ojo si un selector «parecía un control». Se retiró el 2026-09-22 al
 * comprobar dos cosas:
 *
 *  1. QUIÉN LO SABE DE VERDAD YA LO COMPRUEBA. El censo de clic muerto corre en
 *     el navegador, con el DOM delante, y marca el fallo como `"prueba"` — no
 *     acusa a la página, nombra el arreglo («X no tiene manejador de clic. Si se
 *     dispara al verse, usa desplaza:"…"») y remata con su `(note: …)`. Una
 *     lista negra aquí es una SEGUNDA capa decidiendo lo mismo desde peor sitio,
 *     que es un defecto que este repo ya tiene nombrado.
 *  2. ADIVINAR PLAUSIBILIDAD NO ES LA FORMA. Un objetivo que no sirve se
 *     descarta con una comprobación DEFINIDA que además nombra la salida, no
 *     con una corazonada sobre si «parece un botón».
 *
 * Y la lista negra ya se había equivocado una vez en su primera hora de vida:
 * rechazaba toda descendencia y se dejó fuera el caso REAL de la corrida,
 * `#tabs button`.
 *
 * Lo que queda es SINTÁCTICO y definido, nada de opinión:
 */
function promovible(sel: string): boolean {
  const s = sel.trim();
  if (!s || s.length > 80) return false;
  // Una lista (`a, b`) no es UN grupo; una pseudo-clase no se puede razonar.
  if (/[,:]/.test(s)) return false;
  // Un id lo coge `conClicDerivado`, que va antes en la cadena. Es un desvío de
  // ruta —«esto lo hace el otro»—, no un juicio sobre el selector.
  return !s.split(/[\s>+~]+/).filter(Boolean).pop()?.startsWith("#");
}

/**
 * LA PROMESA SIN ACCIÓN, REPARADA CUANDO NO HAY NINGÚN id — la clase `sin_id`.
 *
 * 🔴 ES LA CLASE QUE MÁS PESA (3 de 4 proyectos en producción) y la única que
 * no tenía reparación, porque TODO lo promovible de esos runtimes casa con
 * VARIOS elementos: el modelo cablea con `querySelectorAll('.add')` o crea los
 * controles con `createElement`, sin un id en toda la página.
 *
 * 🔴 NO ELIGE UN BOTÓN, y ésa es la línea entera. Promueve el selector que el
 * PROPIO MODELO usó para cablear —igual que `conDesplazaDerivado` promueve el
 * `donde` que él escribió— y le pone `cualquiera: true`, que es la autorización
 * explícita a desambiguar. Ante un objetivo ambiguo no se escoge: se exige que
 * alguien DECLARE que da igual cuál. Aquí quien lo declara es el
 * `querySelectorAll` del modelo, que significa exactamente eso.
 *
 * `null` en cuanto haya duda: si la promesa ya actúa, si no hay selector que
 * promover, o si el que hay no puede ser un control.
 */
export function conGrupoDerivado(prueba: unknown, runtime: string): unknown | null {
  if (!Array.isArray(prueba) || prueba.length === 0) return null;
  const pasos = prueba.filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
  if (pasos.length !== prueba.length) return null;
  // Si alguno ya actúa, esto no es `sin_accion` y no hay nada que reparar.
  if (
    pasos.some(
      (p) => p.clic !== undefined || p.escribe !== undefined || p.desplaza !== undefined,
    )
  ) {
    return null;
  }
  // Lo que la promesa MIRA no puede ser lo que se pulsa: pulsar el propio
  // marcador que se espera que cambie es la trampa del clic decorativo.
  const mirados = new Set<string>();
  for (const paso of pasos) {
    const entonces = paso.entonces;
    if (!Array.isArray(entonces)) continue;
    for (const e of entonces) {
      const donde = (e as { donde?: unknown })?.donde;
      if (typeof donde === "string") mirados.add(donde.trim());
    }
  }
  for (const m of runtime.matchAll(SELECTOR_DEL_MODELO)) {
    const sel = (m[2] ?? "").trim();
    if (!sel || mirados.has(sel)) continue;
    if (!promovible(sel)) continue;
    return [{ ...pasos[0], clic: sel, cualquiera: true }, ...pasos.slice(1)];
  }
  return null;
}

/**
 * POR QUÉ ESTA PROMESA SALIÓ `sin_accion` — la CLASE DE FORMA.
 *
 * 🔴 EL PELDAÑO QUE FALTABA. Una telemetría de entradas mal formadas que sólo
 * cuenta «falló» no sirve para arreglar nada: hay que saber QUÉ FORMA llega mal
 * y si la reparación sirvió PARA ESA FORMA. Aquí ya se contaba el resultado
 * (`seguimientoDelRechazo`, y el log de `toolEditarPagina`), pero no la CLASE —
 * y sin clase un 56% de `sin_accion` es un número que no dice qué arreglar.
 *
 * 🔴 Y ES LA PREGUNTA ABIERTA DE LA CASA. Cinco intentos de mover al modelo con
 * TEXTO fracasaron; lo único que funcionó fue REPARAR la entrada. Cuál reparar
 * ahora es una decisión que hoy se toma a ojo: producción dice 56% y que 3 de 4
 * proyectos cablean con `createElement` sin id, pero eso se contó A MANO
 * leyendo logs. Esto lo cuenta solo.
 *
 * Las clases son ACCIONABLES a propósito — cada una nombra el arreglo que le
 * tocaría, no un síntoma:
 *
 *  · `observador`   → el runtime mira el viewport. `conDesplazaDerivado` puede.
 *  · `con_id`       → hay un `#id` junto a un listener. `conClicDerivado` puede.
 *  · `sin_id`       → HAY listeners de clic y NINGÚN id que nombrar. Es la
 *                     familia de `createElement`, la que produce el 3 de 4 de
 *                     producción. Desde el 2026-09-21 (noche) la repara
 *                     `conGrupoDerivado` promoviendo el selector del propio
 *                     modelo con `cualquiera: true`.
 *  · `sin_listener` → ni clic ni observador: no hay conducta que probar, o vive
 *                     en un sitio que no estamos leyendo.
 *  · `forma_rara`   → la `prueba` no es la lista de objetos que se espera.
 */
export type ClaseSinAccion =
  | "observador"
  | "con_id"
  | "sin_id"
  | "sin_listener"
  | "forma_rara";

export function claseDeSinAccion(prueba: unknown, runtime: string): ClaseSinAccion {
  if (!Array.isArray(prueba) || prueba.length === 0) return "forma_rara";
  if (!prueba.every((p) => !!p && typeof p === "object")) return "forma_rara";
  // El orden es el de las reparaciones que existen: primero las que SE PUEDEN
  // arreglar, para que `sin_id` signifique de verdad «ninguna sirve».
  if (DISPARA_AL_VERSE.test(runtime)) return "observador";
  if (derivarClic(runtime) !== null) return "con_id";
  return /["']click["']/.test(runtime) ? "sin_id" : "sin_listener";
}

/** Qué le pasó al rechazo ANTERIOR, visto en el intento de ahora. */
export type SeguimientoRechazo = "arreglada" | "sigue_mal" | "otro_motivo";

/**
 * ¿SIRVIÓ EL AVISO? — el peldaño que Claude Code tiene y aquí faltaba.
 *
 * Allí, cuando la entrada del modelo no valida, se intenta repararla y se
 * CUENTA si el intento quedó bien o sigue mal. El aviso no se manda a ciegas:
 * se mide si sirvió.
 *
 * Aquí no había nada de eso, y se nota en cómo nos enteramos: que `sin_accion`
 * saliera «en casi todas las vueltas del carrito» lo supo alguien leyendo los
 * logs a mano el 2026-09-17. Con esto, el propio log lo dice.
 *
 * NO juzga la prueba —de eso ya se encarga `parseBehaviorSpec`—: sólo compara
 * el rechazo de antes con el de ahora. Y separa «otro motivo» de «sigue mal» a
 * propósito: un modelo que cambia de error se está acercando, y contarlo junto
 * al que repite el mismo escondería justo la diferencia que interesa.
 */
export function seguimientoDelRechazo(
  previo: string | null | undefined,
  ahora: string | null,
): SeguimientoRechazo | null {
  if (!previo) return null;
  if (!ahora) return "arreglada";
  return ahora === previo ? "sigue_mal" : "otro_motivo";
}
