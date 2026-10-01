// El botón del micrófono del chat, como el prototipo: mantén para grabar;
// desliza a la izquierda para cancelar; un toque corto la deja grabando sola
// y el botón pasa a «enviar». Puro: el hook de la grabadora hace lo que diga.
export const TOQUE_CORTO_MS = 350;
export const CANCELA_A_PX = 120;

export type Micro = { fase: "quieto" } | { fase: "grabando"; desde: number; x0: number; fijo: boolean };
export type Gesto =
  | { tipo: "bajar"; t: number; x: number }
  | { tipo: "mover"; x: number; escala: number }
  | { tipo: "subir"; t: number }
  | { tipo: "cancelar" };
export type EfectoDelMicro = "empezar" | "cancelar" | "enviar" | null;

const QUIETO: Micro = { fase: "quieto" };

/** `arrastre`: cuánto se movió el dedo a la izquierda, en px del lienzo (≤ 0), para la pista «‹ Desliza para cancelar». */
export function conGesto(m: Micro, g: Gesto): { micro: Micro; efecto: EfectoDelMicro; arrastre: number } {
  if (m.fase === "quieto") {
    return g.tipo === "bajar"
      ? { micro: { fase: "grabando", desde: g.t, x0: g.x, fijo: false }, efecto: "empezar", arrastre: 0 }
      : { micro: m, efecto: null, arrastre: 0 };
  }
  switch (g.tipo) {
    case "mover": {
      if (m.fijo) return { micro: m, efecto: null, arrastre: 0 };
      const dx = Math.min(0, (g.x - m.x0) / g.escala);
      return dx < -CANCELA_A_PX ? { micro: QUIETO, efecto: "cancelar", arrastre: 0 } : { micro: m, efecto: null, arrastre: dx };
    }
    case "subir":
      if (!m.fijo && g.t - m.desde < TOQUE_CORTO_MS) return { micro: { ...m, fijo: true }, efecto: null, arrastre: 0 };
      return { micro: QUIETO, efecto: "enviar", arrastre: 0 };
    case "cancelar":
      return { micro: QUIETO, efecto: "cancelar", arrastre: 0 };
    case "bajar":
      // Fija: el toque que la envía se cuenta al soltar.
      return { micro: m, efecto: null, arrastre: 0 };
  }
}

/** Las barras de la burbuja (como el prototipo): n muestras de lo que midió
 *  la grabadora (0–1), entre 22 % y 100 % de alto. */
export function barrasDeLaNota(niveles: number[], n = 28): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(22 + (niveles[Math.floor((i * niveles.length) / n)] ?? 0.3) * 78));
}
