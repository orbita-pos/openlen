// El decodificador que sustituye a la adivinación del CSS. Es núcleo puro: no
// sabe qué es el contraste, sólo convierte bytes de PNG en píxeles.
import { describe, expect, it } from "vitest";
import zlib from "node:zlib";

import { decodificarPng, leerPixel } from "./png-crudo";

/** Construye un PNG de verdad, con el filtro que se le pida por scanline. Es
 *  la única forma de probar los cinco filtros: Chromium elige el suyo y no se
 *  le puede pedir uno concreto. */
function png(ancho: number, alto: number, canales: 3 | 4, filas: readonly (readonly number[])[], filtros: readonly number[]): Buffer {
  const crc32 = (buf: Buffer) => {
    let c = 0;
    let crc = 0xffffffff;
    for (let n = 0; n < buf.length; n += 1) {
      c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (tipo: string, datos: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length, 0);
    const td = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;
  ihdr[9] = canales === 4 ? 6 : 2;
  const crudo: number[] = [];
  for (let y = 0; y < alto; y += 1) {
    crudo.push(filtros[y]);
    for (const byte of filas[y]) crudo.push(byte);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from(crudo))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("decodificarPng", () => {
  it("lee RGB de 8 bits sin filtro", () => {
    const img = decodificarPng(png(2, 1, 3, [[10, 20, 30, 40, 50, 60]], [0]));
    expect(img.ancho).toBe(2);
    expect(img.alto).toBe(1);
    expect(img.canales).toBe(3);
    expect(leerPixel(img, 0, 0)).toEqual([10, 20, 30]);
    expect(leerPixel(img, 1, 0)).toEqual([40, 50, 60]);
  });

  it("lee RGBA de 8 bits y descarta el alfa al muestrear", () => {
    const img = decodificarPng(png(1, 1, 4, [[9, 8, 7, 128]], [0]));
    expect(img.canales).toBe(4);
    expect(leerPixel(img, 0, 0)).toEqual([9, 8, 7]);
  });

  // LOS CINCO FILTROS. Chromium elige el suyo por scanline y no se le puede
  // pedir uno: si uno solo está mal, el fondo sale desplazado y el medidor
  // inventa hallazgos con una confianza total.
  it("deshace el filtro Sub (1)", () => {
    // Sub: cada byte se guarda como diferencia con el píxel de su izquierda.
    const img = decodificarPng(png(2, 1, 3, [[10, 20, 30, 5, 5, 5]], [1]));
    expect(leerPixel(img, 1, 0)).toEqual([15, 25, 35]);
  });

  it("deshace el filtro Up (2)", () => {
    const img = decodificarPng(png(1, 2, 3, [[10, 20, 30], [5, 5, 5]], [0, 2]));
    expect(leerPixel(img, 0, 1)).toEqual([15, 25, 35]);
  });

  it("deshace el filtro Average (3)", () => {
    // Average: bruto + floor((izquierda + arriba) / 2).
    const img = decodificarPng(png(1, 2, 3, [[10, 20, 30], [1, 1, 1]], [0, 3]));
    expect(leerPixel(img, 0, 1)).toEqual([6, 11, 16]);
  });

  it("deshace el filtro Paeth (4)", () => {
    const img = decodificarPng(png(1, 2, 3, [[10, 20, 30], [1, 1, 1]], [0, 4]));
    expect(leerPixel(img, 0, 1)).toEqual([11, 21, 31]);
  });

  it("envuelve los bytes a 8 bits, como manda el formato", () => {
    const img = decodificarPng(png(2, 1, 3, [[250, 250, 250, 10, 10, 10]], [1]));
    expect(leerPixel(img, 1, 0)).toEqual([4, 4, 4]);
  });

  // LANZAR ES CAER AL RESPALDO. Un decodificador que devuelve basura ante algo
  // que no entiende es peor que uno que no decodifica: el medidor se creería
  // los píxeles inventados.
  it("lanza ante lo que no es un PNG", () => {
    expect(() => decodificarPng(Buffer.from("jpeg"))).toThrow();
  });

  it("lanza ante 16 bits, paleta y entrelazado", () => {
    const dieciseis = png(1, 1, 3, [[1, 2, 3]], [0]);
    dieciseis[24] = 16; // IHDR.bitDepth
    expect(() => decodificarPng(dieciseis)).toThrow();

    const paleta = png(1, 1, 3, [[1, 2, 3]], [0]);
    paleta[25] = 3; // IHDR.colorType = paleta
    expect(() => decodificarPng(paleta)).toThrow();

    const entrelazado = png(1, 1, 3, [[1, 2, 3]], [0]);
    entrelazado[28] = 1; // IHDR.interlace
    expect(() => decodificarPng(entrelazado)).toThrow();
  });
});

describe("leerPixel", () => {
  it("devuelve null fuera de la imagen, en vez de leer memoria de al lado", () => {
    const img = decodificarPng(png(1, 1, 3, [[1, 2, 3]], [0]));
    expect(leerPixel(img, -1, 0)).toBeNull();
    expect(leerPixel(img, 0, -1)).toBeNull();
    expect(leerPixel(img, 1, 0)).toBeNull();
    expect(leerPixel(img, 0, 1)).toBeNull();
  });
});

// El hueco que dejó la revisión de la Tarea 1: la guarda de datos truncados
// estaba escrita y verificada a mano, pero ninguna prueba la ejercía. Y es
// load-bearing — sin ella, un buffer corto produce ceros en silencio
// (`undefined & 0xff === 0`), o sea PÍXELES NEGROS INVENTADOS, que es
// exactamente el modo de fallo que todo este trabajo viene a quitar.
describe("datos truncados", () => {
  it("lanza en vez de rellenar con negro lo que falta", () => {
    // Un PNG que dice 4 filas y sólo trae los datos de una.
    const zlib = require("node:zlib") as typeof import("node:zlib");
    const crc32 = (buf: Buffer) => {
      let c = 0;
      let crc = 0xffffffff;
      for (let n = 0; n < buf.length; n += 1) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
      }
      return (crc ^ 0xffffffff) >>> 0;
    };
    const chunk = (tipo: string, datos: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(datos.length, 0);
      const td = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td), 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(4, 4); // dice 4 filas
    ihdr[8] = 8;
    ihdr[9] = 2;
    const truncado = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(Buffer.from([0, 1, 2, 3]))), // sólo 1 fila
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => decodificarPng(truncado)).toThrow(/truncados/);
  });
});
