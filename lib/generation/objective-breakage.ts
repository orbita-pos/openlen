// Lo que está roto de forma OBJETIVA en una página ya renderizada.
//
// No es gusto y no es una opinión de modelo: son cuatro hechos que sólo el
// render conoce. Existe porque la puerta de generación medía estas cuatro
// cosas y luego las tiraba — la única cosa capaz de disparar una regeneración
// era el veredicto de un crítico de visión, es decir, una opinión.
//
// Los motivos salen en lenguaje concreto y con números, no como categorías.
// Medido en este repo: al reparador se le mandaba la palabra "typography" y
// no tocaba nada, porque una categoría no dice qué cambiar.
//
// ⚠️ Y salen SÓLO los que el modelo puede arreglar. Un fichero que no baja no
// se arregla reescribiendo la página; ésos van por `roturaDeRed`. El porqué,
// con la avería que lo pidió, está en `rotura-ajena.ts`.

import { partirGritos } from "./rotura-ajena";

export interface MeasuredPage {
  readonly mobileOverflow?: boolean;
  /** QUIÉN se sale y hasta dónde. La sonda lo mide desde siempre y esta
   *  interfaz lo tiraba en la frontera de tipos: el resultado era que el
   *  usuario leía «algo se sale de la pantalla», que es exactamente la
   *  categoría que la cabecera de este fichero dice no emitir. */
  readonly overflowCulprit?: string;
  readonly overflowCulpritRight?: number;
  readonly overflowCulpritKind?: "caja" | "tinta";
  readonly invalidGeometry?: boolean;
  /** `texto` es el hallazgo con DUEÑO, y aquí importa más que en ningún otro
   *  sitio: es una frase que el usuario ESCRIBIÓ, así que nombrarla lo lleva
   *  derecho al sitio sin una sola palabra técnica. */
  readonly unreadableText?: readonly {
    readonly contrast: number;
    readonly texto?: string;
    readonly etiqueta?: string;
  }[];
  readonly typographyHierarchy?: {
    readonly rule: string;
    readonly h1FontPx: number | null;
    readonly h1Count?: number;
    readonly heroBodyFontPx: number | null;
  } | null;
  /** Lo que la página tiró al cargar. Es el quinto hecho que sólo el render
   *  conoce, y el único que NO se ve en la captura: un script que muere deja un
   *  screenshot perfecto. */
  readonly runtimeErrors?: readonly string[];
}

const TYPOGRAPHY_REASON: Record<string, (h1: number | null, body: number | null) => string> = {
  h1_missing: () => "la página no tiene un solo <h1> — no hay titular que jerarquizar",
  h1_not_rendered: () => "hay un <h1> pero el navegador no le da caja — está oculto o vacío",
  h1_too_small: (h1) => `el titular mide ${h1}px en móvil — por debajo de 24px no es un titular`,
  hero_body_too_small: (_h1, body) => `el cuerpo del hero mide ${body}px en móvil — por debajo de 12px no se lee`,
  h1_not_dominant: (h1, body) => `el titular mide ${h1}px y el cuerpo ${body}px — no se distinguen`,
};

/** Los hechos que impiden entregar la página. Vacío = nada objetivamente roto.
 *  Un render que no se pudo hacer devuelve vacío a propósito: no medir no es
 *  lo mismo que medir bien, pero tampoco es prueba de rotura, y una página
 *  entera no puede caerse porque Chrome no arrancó. */
export function objectiveBreakage(page: MeasuredPage | null | undefined): string[] {
  if (!page) return [];
  const reasons: string[] = [];
  if (page.mobileOverflow === true) {
    // 🔴 ESTO LO LEE UNA PERSONA, no un modelo: sale tal cual en la pantalla de
    // generación (`emit("medida")` → `use-generation.ts` → `page-assembling`).
    // Por eso se dice QUÉ CLASE de problema es y cuánto mide, y NO el selector
    // del nodo: a un creador no técnico `div.bg-surface.border` no le dice nada.
    // La dirección exacta es para el modelo, y ése tiene su propio canal
    // (`lib/agent/aviso-medido.ts`).
    const ancho = page.overflowCulpritRight
      ? ` y llega a ${Math.round(page.overflowCulpritRight)}px de ancho`
      : "";
    reasons.push(
      page.overflowCulpritKind === "tinta"
        ? `el documento se desborda a lo ancho en móvil (390px) — hay un texto largo sin espacios (una dirección, un enlace) que no cabe${ancho} y empuja la página`
        : page.overflowCulpritKind === "caja"
          ? `el documento se desborda a lo ancho en móvil (390px) — un bloque mide más que la pantalla${ancho}`
          : "el documento se desborda a lo ancho en móvil (390px) — algo se sale de la pantalla",
    );
  }
  if (page.invalidGeometry === true) {
    reasons.push("la geometría del documento es inválida — el navegador no puede medir el ancho");
  }
  const unreadable = page.unreadableText ?? [];
  if (unreadable.length > 0) {
    const peor = [...unreadable].sort((a, b) => a.contrast - b.contrast)[0]!;
    // El texto que el USUARIO escribió es la mejor dirección que existe para él:
    // lo busca en su página y lo encuentra. Sin él, «1 texto ilegible» le manda
    // a recorrer la página entera. Con `etiqueta` como segundo mejor, y la
    // frase de siempre cuando el medidor no encontró texto directo.
    const resto = unreadable.length > 1 ? ` (y ${unreadable.length - 1} más)` : "";
    reasons.push(
      peor.texto
        ? `no se lee «${peor.texto}»${resto} — el navegador lo pinta a ${peor.contrast.toFixed(2)}:1 de contraste sobre su fondo`
        : peor.etiqueta
          ? `no se lee un <${peor.etiqueta}>${resto} — el navegador lo pinta a ${peor.contrast.toFixed(2)}:1 de contraste sobre su fondo`
          : `${unreadable.length} texto(s) que el navegador pinta y nadie puede leer — el peor a ${peor.contrast.toFixed(2)}:1 de contraste`,
    );
  }
  const typography = page.typographyHierarchy;
  if (typography) {
    const reason = TYPOGRAPHY_REASON[typography.rule];
    if (reason) reasons.push(reason(typography.h1FontPx, typography.heroBodyFontPx));
  }
  // El error LITERAL, no una categoría: es la lección de arriba aplicada al
  // JavaScript. "el script falla" no dice qué arreglar; «Assignment to constant
  // variable» sí, y es exactamente lo que el modelo necesita para REPARAR en
  // vez de re-crear. Se acotan a tres: más que eso suelen ser el mismo fallo
  // rebotando, y el presupuesto del prompt no es infinito.
  // "al cargar" ya no es cierto: desde el 2026-08-23 la medición también APRIETA
  // los controles, así que un grito puede venir del clic. Mandar al modelo a
  // mirar el arranque cuando el fallo está en un manejador es peor que no
  // decirle dónde — se pone a revisar el código que sí funciona.
  for (const grito of partirGritos(page.runtimeErrors).propios.slice(0, 3)) {
    reasons.push(`el JavaScript de la página falla (al cargarla o al usar sus controles): ${grito}`);
  }
  return reasons;
}

/**
 * Lo que se cayó por DEBAJO del modelo: un fichero que el navegador no pudo
 * bajar, y el «no está definido» que viene detrás.
 *
 * Va aparte de `objectiveBreakage` a propósito y no por orden: aquello es la
 * lista que JUSTIFICA gastarle al usuario una reparación o una reescritura, y
 * esto no la justifica — nadie arregla una cabecera HTTP desde dentro del
 * documento. Pero tiene que OÍRSE, que es la otra mitad de la doctrina: quien
 * llame a esto lo registra y lo cuenta en su informe. Ver `rotura-ajena.ts`.
 */
export function roturaDeRed(page: MeasuredPage | null | undefined): string[] {
  if (!page) return [];
  return [...partirGritos(page.runtimeErrors).ajenos];
}
