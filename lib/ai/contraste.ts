import { leerPixel, type PngCrudo } from "./png-crudo";

/** Un texto que el navegador pintó, medido contra el fondo que de verdad lo
 *  pinta. `probe` es el `data-ol-probe` del elemento cuando el documento venía
 *  marcado, y -1 cuando no: sin él la lectura sirve de señal pero no se puede
 *  reparar.
 *
 *  ⚠️ Vivía en `visual-quality-renderer.ts` hasta el 2026-09-02. Se mudó aquí
 *  —el módulo que lo produce— porque aquél ahora importa `juzgarContraste`, y
 *  al revés habría un ciclo. Aquél lo REEXPORTA: los nueve ficheros que lo
 *  importan de allí no se enteran. */
export interface UnreadableTextFinding {
  readonly probe: number;
  readonly background: string;
  readonly contrast: number;
  /** LA DIRECCIÓN. Sin esto el hallazgo es un número sin dueño, y quien lo
   *  recibe tiene que adivinar cuál de los textos de la página es —MEDIDO el
   *  2026-08-30: cuatro rondas del Agente oscureciendo el velo equivocado y un
   *  monólogo de veinte párrafos razonando a qué elemento pertenecía el
   *  1.00:1—.
   *
   *  Opcionales porque el medidor puede no encontrar texto directo (un
   *  elemento cuyo texto vive en un hijo), y un hallazgo sin nombre sigue
   *  valiendo más que ninguno. */
  readonly texto?: string;
  readonly etiqueta?: string;
  readonly color?: string;
}

/** Un texto candidato, tal y como lo devuelve el navegador: HECHOS, sin
 *  juicio. El navegador no decide si algo es ilegible — eso pasa aquí. */
export interface CandidatoDeContraste {
  readonly texto: string;
  readonly etiqueta: string;
  /** El color CSS del propio elemento. Fiable: es propiedad suya, no necesita
   *  composición. (Su límite conocido está en §6 de la spec: bajo un `filter`
   *  o un `mix-blend-mode` ancestro el glifo también se transforma.) */
  readonly color: string;
  readonly probe: number;
  /** Nueve puntos, en coordenadas de DOCUMENTO — las mismas que la captura,
   *  que se toma con `captureBeyondViewport`. */
  readonly puntos: readonly (readonly [number, number])[];
  /** Lo que concluyó el paseo por CSS, o `null` cuando dudó. RESPALDO. */
  readonly fondoCss: string | null;
  /** Velos translúcidos acumulados por el paseo por CSS, `[r,g,b,alfa]`. Sólo
   *  se usan en el respaldo: el píxel ya los lleva compuestos. */
  readonly velos: readonly (readonly number[])[];
}

const RGB_RE = /^rgba?\(([^)]+)\)/i;
const SEPARADOR_RE = /[\s,/]+/;
const PESOS = [0.2126, 0.7152, 0.0722];
/** 2:1 es deliberadamente bajo. No mide accesibilidad: separa «cuesta leerlo»
 *  de «no está». */
const UMBRAL = 2;
const TOPE = 12;

function canales(valor: string): number[] | null {
  const bruto = (RGB_RE.exec(valor) ?? ["", ""])[1];
  const partes = bruto.split(SEPARADOR_RE).filter((pieza) => pieza.length > 0).map(Number);
  if (partes.length < 3) return null;
  if (partes.slice(0, 3).some((canal) => !Number.isFinite(canal))) return null;
  return partes;
}

function luminancia(rgb: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < 3; i += 1) {
    const escalado = Math.min(255, Math.max(0, rgb[i])) / 255;
    total += PESOS[i] * (escalado <= 0.03928 ? escalado / 12.92 : Math.pow((escalado + 0.055) / 1.055, 2.4));
  }
  return total;
}

function ratio(a: readonly number[], b: readonly number[]): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hex(rgb: readonly number[]): string {
  let salida = "#";
  for (let i = 0; i < 3; i += 1) {
    salida += Math.min(255, Math.max(0, Math.round(rgb[i]))).toString(16).padStart(2, "0");
  }
  return salida;
}

/**
 * Decide qué textos nadie puede leer.
 *
 * EL PÍXEL MANDA. `pixeles` es la captura con el texto puesto en
 * `color: transparent`, así que cada punto muestreado es el fondo COMPUESTO por
 * Chromium — fotos, degradados, hermanos, velos, `mix-blend-mode`, `filter`,
 * pseudo-elementos y cadenas de `opacity` incluidos. Quince años de heurísticas
 * de CSS no cubren eso; una lectura sí.
 *
 * RESPALDO POR CANDIDATO. Si no hay captura, si el decodificado falló, o si
 * algún punto de ESE candidato cae fuera de la imagen (página más alta que el
 * tope de captura), se usa `fondoCss` — el paseo por CSS de siempre, con sus
 * velos. Y si el paseo por CSS también dudó (`fondoCss === null`), no hay
 * hallazgo: una duda jamás se convierte en un hallazgo.
 */
export function juzgarContraste(
  candidatos: readonly CandidatoDeContraste[],
  pixeles: PngCrudo | null,
): UnreadableTextFinding[] {
  const salida: UnreadableTextFinding[] = [];
  const vistos = new Set<string>();

  for (const candidato of candidatos) {
    if (salida.length >= TOPE) break;

    const texto = canales(candidato.color);
    if (!texto) continue;
    // Un texto translúcido se lee sobre lo que tenga debajo; medirlo como si
    // fuera opaco es inventar un hallazgo.
    if (texto.length > 3 && Number.isFinite(texto[3]) && texto[3] < 0.9) continue;

    // ── LOS FONDOS CANDIDATOS ────────────────────────────────────────────
    // Del píxel salen hasta nueve; del respaldo salen dos (desnudo y con los
    // velos a plena fuerza). En ambos casos manda la lectura MÁS FAVORABLE: si
    // en algún sitio se lee, no podemos afirmar que sea invisible.
    const fondos: number[][] = [];
    if (pixeles) {
      let completo = true;
      for (const [x, y] of candidato.puntos) {
        const pixel = leerPixel(pixeles, x, y);
        if (!pixel) { completo = false; break; }
        fondos.push([pixel[0], pixel[1], pixel[2]]);
      }
      if (!completo) fondos.length = 0;
    }
    if (fondos.length === 0) {
      if (candidato.fondoCss === null) continue;
      const base = canales(candidato.fondoCss);
      if (!base) continue;
      fondos.push([base[0], base[1], base[2]]);
      const conVelos = [base[0], base[1], base[2]];
      for (let i = candidato.velos.length - 1; i >= 0; i -= 1) {
        const velo = candidato.velos[i];
        for (let canal = 0; canal < 3; canal += 1) {
          conVelos[canal] = velo[canal] * velo[3] + conVelos[canal] * (1 - velo[3]);
        }
      }
      fondos.push(conVelos);
    }

    // EL NÚMERO Y EL COLOR TIENEN QUE SER LA MISMA MEDIDA. Se reporta el fondo
    // del punto que dio el contraste que se reporta — si no, el hallazgo diría
    // «1,04:1 sobre #ffffff» con el 1,04 leído en un sitio y el #ffffff en
    // otro, y el modelo iría a buscar un color que nunca produjo ese número.
    let mejor = 0;
    let fondoDelHallazgo = fondos[0];
    for (const fondo of fondos) {
      const valor = ratio(texto, fondo);
      if (valor > mejor) {
        mejor = valor;
        fondoDelHallazgo = fondo;
      }
    }
    if (mejor >= UMBRAL) continue;

    // LA CLAVE LLEVA LA ETIQUETA. `data-ol-probe` sólo lo escribe la reparación
    // del lado de Crear, así que en el camino del Agente `probe` vale siempre
    // -1 y sin la etiqueta la clave se reduciría al color de fondo: de todos
    // los textos invisibles sobre blanco sobreviviría UNO. Con la etiqueta,
    // un <h1> y un <p> dejan de ser «el mismo hallazgo», y cinco <li> apagados
    // por la misma regla siguen colapsando — que es para lo que existe.
    const fondoHex = hex(fondoDelHallazgo);
    const clave = `${candidato.probe}|${fondoHex}|${candidato.etiqueta}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    salida.push({
      probe: candidato.probe,
      texto: candidato.texto,
      etiqueta: candidato.etiqueta,
      color: hex(texto),
      background: fondoHex,
      contrast: Math.round(mejor * 100) / 100,
    });
  }

  return salida;
}
