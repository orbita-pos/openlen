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
   *  texto. `visible` / `oculto` — el elemento se ve o no. */
  readonly que: "cambia" | "contiene" | "es" | "visible" | "oculto";
  /** Requerido por `contiene` y `es`; ignorado por los demás. */
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
  | "sin_accion"
  | "sin_expectativa"
  | "selector_invalido"
  | "falta_valor";

export type SpecResultado =
  | { readonly kind: "ninguna" }
  | { readonly kind: "spec"; readonly pasos: readonly PasoSpec[] }
  | { readonly kind: "error"; readonly reason: SpecRechazo };

/** Seis pasos. Una promesa de una página cabe de sobra; más es alguien
 *  escribiendo una suite dentro de un turno del chat. */
export const MAX_PASOS = 6;
export const MAX_VECES = 10;

/** Selectores conservadores a propósito: id, clase, etiqueta, atributo,
 *  descendencia. Nada de `:has()` ni comas — un selector que casa con varios
 *  elementos hace la prueba ambigua, y una prueba ambigua miente. */
const SELECTOR_OK = /^[#.]?[A-Za-z][\w-]*(?:[\s>][#.]?[A-Za-z][\w-]*)*$|^\[[\w-]+(?:=["'][^"']*["'])?\]$/;

function selectorValido(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= 80 && SELECTOR_OK.test(s.trim());
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
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") return { kind: "error", reason: "sin_accion" };

    const escribe: Record<string, string> = {};
    if (p.escribe !== undefined) {
      if (typeof p.escribe !== "object" || p.escribe === null) {
        return { kind: "error", reason: "sin_accion" };
      }
      for (const [sel, val] of Object.entries(p.escribe as Record<string, unknown>)) {
        if (!selectorValido(sel)) return { kind: "error", reason: "selector_invalido" };
        escribe[sel] = String(val ?? "").slice(0, 120);
      }
    }
    const clic = typeof p.clic === "string" ? p.clic.trim() : undefined;
    if (clic !== undefined && !selectorValido(clic)) {
      return { kind: "error", reason: "selector_invalido" };
    }
    // El PRIMER paso necesita acción: mirar un elemento quieto no comprueba una
    // promesa de comportamiento, comprueba el HTML.
    //
    // Los siguientes NO. MEDIDO el 2026-08-22: pidiéndole arreglar una ruleta,
    // el modelo escribe un primer paso con el clic y un segundo que sólo mira
    // («…y además el resultado contiene "¡"»). Es una comprobación ADICIONAL
    // sobre el estado que dejó el paso anterior, y es exactamente lo que uno
    // escribiría. Rechazarla tiraba 2 de cada 4 pruebas bien intencionadas —
    // y una prueba tirada es una promesa sin comprobar.
    if (!clic && Object.keys(escribe).length === 0 && pasos.length === 0) {
      return { kind: "error", reason: "sin_accion" };
    }

    const entonces = Array.isArray(p.entonces) ? (p.entonces as Record<string, unknown>[]) : [];
    if (entonces.length === 0) return { kind: "error", reason: "sin_expectativa" };
    const exps: Expectativa[] = [];
    for (const e of entonces) {
      if (!e || typeof e !== "object" || !selectorValido(e.donde)) {
        return { kind: "error", reason: "selector_invalido" };
      }
      const que = e.que;
      if (que !== "cambia" && que !== "contiene" && que !== "es" && que !== "visible" && que !== "oculto") {
        return { kind: "error", reason: "sin_expectativa" };
      }
      if ((que === "contiene" || que === "es") && typeof e.valor !== "string") {
        return { kind: "error", reason: "falta_valor" };
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
  return { kind: "spec", pasos };
}

/** Lo que un paso falló, en la lengua del usuario — la lee él, y también el
 *  modelo, que necesita saber QUÉ elemento y QUÉ se esperaba. */
export interface FalloSpec {
  readonly paso: number;
  readonly mensaje: string;
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
(() => {
  var PASOS = ${JSON.stringify(JSON.stringify(pasos))};
  var pasos = JSON.parse(PASOS);
  var fallos = [];
  // Un clic que navega se lleva la página y con ella la comprobación. Se
  // impide sólo la acción por defecto: el manejador del modelo corre igual.
  document.addEventListener("click", function (e) { e.preventDefault(); }, true);
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);

  var texto = function (el) { return (el.textContent || "").replace(/\\s+/g, " ").trim(); };
  var seVe = function (el) {
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  for (var i = 0; i < pasos.length; i++) {
    var p = pasos[i];
    // ANTES: se guarda el texto de cada objetivo para poder decir si "cambia".
    var antes = {};
    for (var a = 0; a < p.entonces.length; a++) {
      var d = p.entonces[a].donde;
      var e0 = document.querySelector(d);
      antes[d] = e0 ? texto(e0) : null;
    }

    try {
      if (p.escribe) {
        for (var sel in p.escribe) {
          var campo = document.querySelector(sel);
          if (!campo) { fallos.push([i, "no existe el campo " + sel]); continue; }
          campo.value = p.escribe[sel];
          campo.dispatchEvent(new Event("input", { bubbles: true }));
          campo.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      if (p.clic) {
        var boton = document.querySelector(p.clic);
        if (!boton) {
          fallos.push([i, "no existe el control " + p.clic]);
          continue;
        }
        for (var v = 0; v < (p.veces || 1); v++) {
          boton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
      }
    } catch (err) {
      fallos.push([i, "la acción lanzó: " + (err && err.message ? err.message : String(err))]);
      continue;
    }

    for (var k = 0; k < p.entonces.length; k++) {
      var exp = p.entonces[k];
      var el = document.querySelector(exp.donde);
      if (!el) { fallos.push([i, "no existe " + exp.donde]); continue; }
      var ahora = texto(el);
      if (exp.que === "cambia") {
        if (ahora === antes[exp.donde]) {
          fallos.push([i, exp.donde + ' no cambió (sigue diciendo "' + ahora.slice(0, 40) + '")']);
        }
      } else if (exp.que === "contiene") {
        if (ahora.toLowerCase().indexOf(String(exp.valor).toLowerCase()) === -1) {
          fallos.push([i, exp.donde + ' debía contener "' + exp.valor + '" y dice "' + ahora.slice(0, 40) + '"']);
        }
      } else if (exp.que === "es") {
        if (ahora !== String(exp.valor)) {
          fallos.push([i, exp.donde + ' debía ser "' + exp.valor + '" y es "' + ahora.slice(0, 40) + '"']);
        }
      } else if (exp.que === "visible") {
        if (!seVe(el)) fallos.push([i, exp.donde + " debía verse y no se ve"]);
      } else if (exp.que === "oculto") {
        if (seVe(el)) fallos.push([i, exp.donde + " debía estar oculto y se ve"]);
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
    if (Number.isFinite(paso) && mensaje) out.push({ paso: paso + 1, mensaje: mensaje.slice(0, 200) });
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
export function specRechazoAviso(reason: SpecRechazo): string {
  const porque: Record<SpecRechazo, string> = {
    vacia: "la prueba venía vacía",
    demasiados_pasos: `la prueba trae más de ${MAX_PASOS} pasos`,
    sin_accion: "un paso no hacía nada (ni pulsar ni escribir)",
    sin_expectativa: "un paso no decía qué debía pasar después",
    selector_invalido: "un selector no es válido o apunta a varios elementos",
    falta_valor: "una comprobación de texto no traía con qué comparar",
  };
  return `No pude comprobar el comportamiento: ${porque[reason]}. El cambio sí se guardó.`;
}
