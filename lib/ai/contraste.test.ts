// EL JUICIO, fuera del navegador. Hasta hoy esto vivía dentro de
// `page.evaluate`, donde ni siquiera se podía llamar a una función con nombre
// (el helper `__name` de esbuild no existe en la página), y por tanto no había
// forma de probarlo sin arrancar Chromium. Aquí corre en milisegundos.
import { describe, expect, it } from "vitest";

import { juzgarContraste, type CandidatoDeContraste } from "./contraste";
import { decodificarPng, type PngCrudo } from "./png-crudo";
import zlib from "node:zlib";

/** Un lienzo de un solo color, del tamaño que se pida. */
function lienzo(ancho: number, alto: number, color: readonly [number, number, number]): PngCrudo {
  const crudo: number[] = [];
  for (let y = 0; y < alto; y += 1) {
    crudo.push(0);
    for (let x = 0; x < ancho; x += 1) crudo.push(color[0], color[1], color[2]);
  }
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
  ihdr[9] = 2;
  return decodificarPng(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from(crudo))),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

const candidato = (parcial: Partial<CandidatoDeContraste> = {}): CandidatoDeContraste => ({
  texto: "Mariscos frescos desde 1987",
  etiqueta: "p",
  color: "rgb(255, 255, 255)",
  probe: -1,
  puntos: [[5, 5]],
  fondoCss: "rgb(255, 255, 255)",
  velos: [],
  ...parcial,
});

describe("el píxel manda", () => {
  it("marca el texto blanco sobre un píxel blanco", () => {
    const malos = juzgarContraste([candidato()], lienzo(10, 10, [255, 255, 255]));
    expect(malos).toHaveLength(1);
    expect(malos[0].background).toBe("#ffffff");
    expect(malos[0].contrast).toBe(1);
    expect(malos[0].texto).toBe("Mariscos frescos desde 1987");
    expect(malos[0].etiqueta).toBe("p");
    expect(malos[0].color).toBe("#ffffff");
  });

  // 🔴 EL FALSO POSITIVO DE AURORA, en una prueba. El CSS decía blanco; el
  // píxel dice verde oscuro. Costó 17 ediciones y una portada peor que la de
  // partida.
  it("gana el píxel cuando el CSS se equivoca", () => {
    const malos = juzgarContraste(
      [candidato({ texto: "Encuentra casa en Monterrey", fondoCss: "rgb(255, 255, 255)" })],
      lienzo(10, 10, [28, 58, 45]),
    );
    expect(malos).toEqual([]);
  });
});

describe("la regla de los nueve puntos", () => {
  // Sobre una foto con manchas, un punto legible SALVA al texto: si en algún
  // sitio se lee, no podemos afirmar que sea invisible. Es la doctrina de los
  // dos extremos del velo, extendida.
  it("gana la lectura MÁS FAVORABLE", () => {
    // Lienzo mitad blanco (arriba) y mitad negro (abajo), texto blanco.
    const ancho = 4;
    const alto = 4;
    const img = lienzo(ancho, alto, [255, 255, 255]);
    const datos = new Uint8Array(img.datos);
    for (let y = 2; y < alto; y += 1) {
      for (let x = 0; x < ancho; x += 1) {
        const o = (y * ancho + x) * 3;
        datos[o] = 0; datos[o + 1] = 0; datos[o + 2] = 0;
      }
    }
    const mezcla: PngCrudo = { ...img, datos };
    const malos = juzgarContraste([candidato({ puntos: [[1, 0], [1, 3]] })], mezcla);
    expect(malos).toEqual([]);
  });

  it("pero si TODOS los puntos son malos, es un hallazgo", () => {
    const malos = juzgarContraste([candidato({ puntos: [[1, 1], [2, 2], [3, 3]] })], lienzo(10, 10, [255, 255, 255]));
    expect(malos).toHaveLength(1);
  });

  it("2:1 es el umbral: separa «cuesta leerlo» de «no está»", () => {
    // #808080 contra blanco da 3.95:1 — se lee mal, pero está.
    const malos = juzgarContraste([candidato({ color: "rgb(128, 128, 128)" })], lienzo(10, 10, [255, 255, 255]));
    expect(malos).toEqual([]);
  });
});

describe("las reglas que NO cambian", () => {
  it("se salta el texto translúcido: se lee sobre lo que tenga debajo", () => {
    const malos = juzgarContraste([candidato({ color: "rgba(255, 255, 255, 0.5)" })], lienzo(10, 10, [255, 255, 255]));
    expect(malos).toEqual([]);
  });

  it("deduplica la misma regla repetida sobre cinco <li>", () => {
    const cinco = ["Uno", "Dos", "Tres", "Cuatro", "Cinco"].map((texto) =>
      candidato({ texto, etiqueta: "li" }));
    expect(juzgarContraste(cinco, lienzo(10, 10, [255, 255, 255]))).toHaveLength(1);
  });

  // 🔴 b2b99dae: un <h1> y un <p> NO son «el mismo hallazgo». Antes de esa
  // corrección, el falso positivo del titular tapaba a un párrafo invisible de
  // verdad, en el mismo documento.
  it("NO colapsa dos etiquetas distintas con el mismo fondo", () => {
    const dos = [candidato({ texto: "Titular fantasma", etiqueta: "h1" }), candidato({ texto: "Parrafo fantasma", etiqueta: "p" })];
    expect(juzgarContraste(dos, lienzo(10, 10, [255, 255, 255]))).toHaveLength(2);
  });

  it("no devuelve más de doce hallazgos", () => {
    const muchos = Array.from({ length: 40 }, (_, i) => candidato({ texto: `T${i}`, etiqueta: `t${i}` }));
    expect(juzgarContraste(muchos, lienzo(10, 10, [255, 255, 255])).length).toBeLessThanOrEqual(12);
  });
});

describe("el respaldo: fallar hacia lo de antes", () => {
  it("sin píxeles, manda el paseo por CSS", () => {
    const malos = juzgarContraste([candidato()], null);
    expect(malos).toHaveLength(1);
    expect(malos[0].background).toBe("#ffffff");
  });

  it("con el punto FUERA de la captura, manda el paseo por CSS", () => {
    const malos = juzgarContraste([candidato({ puntos: [[5, 9999]] })], lienzo(10, 10, [0, 0, 0]));
    expect(malos).toHaveLength(1);
    // El píxel habría dicho negro (limpio); el respaldo dice blanco (hallazgo).
    expect(malos[0].background).toBe("#ffffff");
  });

  // UNA DUDA JAMÁS SE CONVIERTE EN UN HALLAZGO. Sin píxel y sin respaldo, nada.
  it("sin píxeles y sin fondo del CSS, no hay hallazgo", () => {
    expect(juzgarContraste([candidato({ fondoCss: null })], null)).toEqual([]);
  });

  it("el respaldo compone los velos contra los dos extremos, como hoy", () => {
    // Crema sobre crema, pero con un velo oscuro a 0.6 encima: en ese extremo
    // se lee, así que no es un hallazgo.
    const malos = juzgarContraste(
      [candidato({ color: "rgb(243, 236, 219)", fondoCss: "rgb(251, 247, 240)", velos: [[30, 77, 59, 0.6]] })],
      null,
    );
    expect(malos).toEqual([]);
  });
});

// El hueco que dejó la revisión de la Tarea 2: la prueba de velos usaba UNO
// solo, así que ningún caso distinguía el ORDEN de composición. Con dos velos
// de colores opuestos el orden sí importa, y componerlos al revés daría otro
// color — y por tanto otro veredicto.
describe("el orden de composición de los velos", () => {
  it("compone del más lejano al más cercano, no al revés", () => {
    // Los paseos por CSS empujan los velos del más CERCANO al texto hacia
    // fuera, así que componer es recorrerlos en sentido INVERSO.
    //
    // ⚠️ El fondo DESNUDO compite siempre: como gana la lectura más favorable,
    // un velo opaco sobre una base legible nunca produce hallazgo —la base lo
    // rescata—. Así que para que el orden se note, los dos extremos del
    // camino correcto tienen que ser malos y sólo el orden equivocado bueno.
    //
    // Texto blanco sobre base blanca (desnudo ⇒ 1,00:1, malo). Velo[0] —el
    // CERCANO— es blanco opaco; velo[1] —el LEJANO— es negro opaco.
    //   · orden correcto (lejano primero, cercano encima) ⇒ acaba BLANCO
    //     ⇒ 1,00:1 ⇒ hallazgo.
    //   · orden invertido ⇒ acabaría NEGRO ⇒ 21:1 ⇒ ningún hallazgo.
    const malos = juzgarContraste(
      [candidato({
        color: "rgb(255, 255, 255)",
        fondoCss: "rgb(255, 255, 255)",
        velos: [[255, 255, 255, 1], [0, 0, 0, 1]],
      })],
      null,
    );
    expect(malos, "si esto sale vacío, los velos se componen al revés").toHaveLength(1);
    expect(malos[0].background).toBe("#ffffff");
    expect(malos[0].contrast).toBe(1);
  });
});
