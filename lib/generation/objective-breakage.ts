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

export interface MeasuredPage {
  readonly mobileOverflow?: boolean;
  readonly invalidGeometry?: boolean;
  readonly unreadableText?: readonly { readonly contrast: number }[];
  readonly typographyHierarchy?: {
    readonly rule: string;
    readonly h1FontPx: number | null;
    readonly h1Count?: number;
    readonly heroBodyFontPx: number | null;
  } | null;
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
    reasons.push("el documento se desborda a lo ancho en móvil (390px) — algo se sale de la pantalla");
  }
  if (page.invalidGeometry === true) {
    reasons.push("la geometría del documento es inválida — el navegador no puede medir el ancho");
  }
  const unreadable = page.unreadableText ?? [];
  if (unreadable.length > 0) {
    const worst = Math.min(...unreadable.map((finding) => finding.contrast));
    reasons.push(
      `${unreadable.length} texto(s) que el navegador pinta y nadie puede leer — el peor a ${worst.toFixed(2)}:1 de contraste`,
    );
  }
  const typography = page.typographyHierarchy;
  if (typography) {
    const reason = TYPOGRAPHY_REASON[typography.rule];
    if (reason) reasons.push(reason(typography.h1FontPx, typography.heroBodyFontPx));
  }
  return reasons;
}
