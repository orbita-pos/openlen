import zlib from "node:zlib";

/** Un PNG ya decodificado a píxeles. `datos` es la rejilla sin filtrar, fila a
 *  fila, con `canales` bytes por píxel. */
export interface PngCrudo {
  readonly ancho: number;
  readonly alto: number;
  readonly canales: 3 | 4;
  readonly datos: Uint8Array;
}

/**
 * Decodifica un PNG de 8 bits, no entrelazado, RGB o RGBA.
 *
 * Es todo lo que Chromium emite por `page.screenshot({ type: "png" })` —
 * MEDIDO el 2026-09-02: color type 2 (RGB), 8 bits, sin entrelazar. El resto
 * de variantes del formato (16 bits, paleta, escala de grises, Adam7) LANZAN a
 * propósito: quien llama trata la excepción como «no pude medir» y cae al
 * paseo por CSS. Un decodificador que devolviera píxeles aproximados ante algo
 * que no entiende sería mucho peor que uno que no decodifica, porque el
 * medidor se creería el resultado.
 *
 * `zlib` es nativo de Node y hace el trabajo pesado (~25-35 ms para una página
 * móvil entera). Por eso esto no necesita `crates/images` ni un binding: nada
 * que reconstruir en la caja después del swap atómico del despliegue.
 */
export function decodificarPng(bytes: Uint8Array): PngCrudo {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("png-crudo: no es un PNG");

  let offset = 8;
  let ihdr: Buffer | null = null;
  const idat: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const largo = buf.readUInt32BE(offset);
    const tipo = buf.toString("ascii", offset + 4, offset + 8);
    const datos = buf.subarray(offset + 8, offset + 8 + largo);
    if (tipo === "IHDR") ihdr = datos;
    else if (tipo === "IDAT") idat.push(datos);
    else if (tipo === "IEND") break;
    offset += 12 + largo;
  }
  if (!ihdr || ihdr.length < 13) throw new Error("png-crudo: sin IHDR");

  const ancho = ihdr.readUInt32BE(0);
  const alto = ihdr.readUInt32BE(4);
  const profundidad = ihdr[8];
  const tipoColor = ihdr[9];
  const entrelazado = ihdr[12];
  if (profundidad !== 8) throw new Error(`png-crudo: profundidad ${profundidad} no soportada`);
  if (entrelazado !== 0) throw new Error("png-crudo: entrelazado no soportado");
  // Lanzar ANTES de derivar `canales`: al revés habría que inventarse un valor
  // imposible para el caso que precisamente no se soporta.
  if (tipoColor !== 2 && tipoColor !== 6) throw new Error(`png-crudo: color type ${tipoColor} no soportado`);
  if (ancho <= 0 || alto <= 0) throw new Error("png-crudo: dimensiones vacías");
  const canales: 3 | 4 = tipoColor === 6 ? 4 : 3;

  const crudo = zlib.inflateSync(Buffer.concat(idat));
  const paso = ancho * canales;
  if (crudo.length < alto * (paso + 1)) throw new Error("png-crudo: datos truncados");

  const datos = new Uint8Array(alto * paso);
  let ptr = 0;
  for (let y = 0; y < alto; y += 1) {
    const filtro = crudo[ptr];
    ptr += 1;
    const destino = y * paso;
    const arriba = destino - paso;
    for (let x = 0; x < paso; x += 1) {
      const bruto = crudo[ptr + x];
      // a = píxel de la izquierda, b = el de arriba, c = el de arriba-izquierda.
      const a = x >= canales ? datos[destino + x - canales] : 0;
      const b = y > 0 ? datos[arriba + x] : 0;
      const c = x >= canales && y > 0 ? datos[arriba + x - canales] : 0;
      let valor: number;
      if (filtro === 0) valor = bruto;
      else if (filtro === 1) valor = bruto + a;
      else if (filtro === 2) valor = bruto + b;
      else if (filtro === 3) valor = bruto + ((a + b) >> 1);
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        valor = bruto + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`png-crudo: filtro ${filtro} desconocido`);
      datos[destino + x] = valor & 0xff;
    }
    ptr += paso;
  }
  return { ancho, alto, canales, datos };
}

/** El píxel de (x, y), o `null` si cae fuera. `null` NO es negro: es «no lo
 *  sé», y quien llama tiene que caer al respaldo. */
export function leerPixel(img: PngCrudo, x: number, y: number): readonly [number, number, number] | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= img.ancho || y >= img.alto) return null;
  const offset = (y * img.ancho + x) * img.canales;
  return [img.datos[offset], img.datos[offset + 1], img.datos[offset + 2]];
}
