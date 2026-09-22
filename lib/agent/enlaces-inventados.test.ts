import { describe, it, expect } from "vitest";
import { enlacesInventados, handleDeRed } from "./enlaces-inventados";

const A = (href: string) => `<a href="${href}">x</a>`;

describe("handleDeRed", () => {
  it("saca el usuario de las redes corrientes, con y sin arroba", () => {
    expect(handleDeRed("https://instagram.com/juan")?.handle).toBe("juan");
    expect(handleDeRed("https://www.tiktok.com/@juan")?.handle).toBe("juan");
    expect(handleDeRed("https://youtube.com/@canal")?.handle).toBe("canal");
    expect(handleDeRed("https://wa.me/34600111222")?.handle).toBe("34600111222");
  });

  it("en LinkedIn salta el segmento de sección — si no, todo el mundo se llamaría «in»", () => {
    expect(handleDeRed("https://linkedin.com/in/juan")?.handle).toBe("juan");
    expect(handleDeRed("https://linkedin.com/company/acme")?.handle).toBe("acme");
  });

  it("no opina sobre lo que no es una red, ni sobre la raíz de una que sí lo es", () => {
    expect(handleDeRed("#")).toBeNull();
    expect(handleDeRed("/menu")).toBeNull();
    expect(handleDeRed("mailto:hola@taller.com")).toBeNull();
    expect(handleDeRed("tel:+34600111222")).toBeNull();
    expect(handleDeRed("https://taller-el-norte.com/nosotros")).toBeNull();
    // Sin ruta no identifica a nadie: es el sitio, no una cuenta.
    expect(handleDeRed("https://instagram.com/")).toBeNull();
  });
});

// ─── UN NÚMERO DICTADO NO ES UNA CUENTA INVENTADA ───────────────────────────
//
// MEDIDO en la batería del 2026-09-22 (`negocio-whatsapp-de-paso`, dos de dos):
// el usuario dice «mi whatsapp 33 1234 5678», el modelo pone
// `wa.me/523312345678` —bien: wa.me exige el prefijo de país— y esto le
// contestaba que se había inventado la cuenta. El número se buscaba como
// subcadena, y con espacios y prefijo no casa nunca.
describe("enlacesInventados — el usuario de wa.me es un número", () => {
  it("🔴 calla con el número dictado con espacios y el prefijo de país delante", () => {
    const r = enlacesInventados({
      antes: "<h1>Mi Negocio</h1>",
      despues: A("https://wa.me/523312345678"),
      fuentes: ["ponme mi whatsapp 33 1234 5678 abajo en el pie de la página"],
    });
    expect(r).toEqual([]);
  });

  it("calla con el número escrito entero, con + y guiones", () => {
    const r = enlacesInventados({
      antes: "<h1>x</h1>",
      despues: A("https://wa.me/3312345678"),
      fuentes: ["mi whatsapp es +52 (33) 1234-5678"],
    });
    expect(r).toEqual([]);
  });

  it("…y sigue cazando el número que no dijo nadie", () => {
    const r = enlacesInventados({
      antes: "<h1>x</h1>",
      despues: A("https://wa.me/525512345678"),
      fuentes: ["ponme mi whatsapp 33 1234 5678"],
    });
    expect(r).toHaveLength(1);
  });

  it("…y una cifra corta —un año, un precio— no avala ningún número", () => {
    const r = enlacesInventados({
      antes: "<p>Desde 2026, menú a 5678</p>",
      despues: A("https://wa.me/525512345678"),
      fuentes: ["pon un botón de whatsapp"],
    });
    expect(r).toHaveLength(1);
  });
});

describe("enlacesInventados", () => {
  it("caza el caso medido: un handle deducido del nombre del negocio", () => {
    const r = enlacesInventados({
      antes: "<h1>Mi Negocio</h1>",
      despues: `<h1>Mi Negocio</h1>${A("https://tiktok.com/@minegocio")}`,
      fuentes: ["agrégame un botón de TikTok"],
    });
    expect(r).toHaveLength(1);
    expect(r[0].handle).toBe("minegocio");
  });

  it("calla si el usuario SÍ dio la cuenta en su mensaje", () => {
    const r = enlacesInventados({
      antes: "<h1>Mi Negocio</h1>",
      despues: A("https://tiktok.com/@tallerelnorte"),
      fuentes: ["mi tiktok es @tallerelnorte, ponlo en el pie"],
    });
    expect(r).toEqual([]);
  });

  it("calla si el handle ya vivía en la página, aunque el enlace sea nuevo", () => {
    const r = enlacesInventados({
      antes: `<p>Síguenos en @tallerelnorte</p>`,
      despues: A("https://instagram.com/tallerelnorte"),
      fuentes: ["ponme el instagram en el pie"],
    });
    expect(r).toEqual([]);
  });

  it("calla sobre un enlace que ya estaba: lo dirá el turno que lo puso, no cada edición posterior", () => {
    const ya = A("https://tiktok.com/@minegocio");
    const r = enlacesInventados({
      antes: ya,
      despues: `${ya}<h2>Nueva sección</h2>`,
      fuentes: ["añade una sección de precios"],
    });
    expect(r).toEqual([]);
  });

  it("también mira el brief, que es donde vive lo que el usuario dijo hace semanas", () => {
    const r = enlacesInventados({
      antes: "<h1>x</h1>",
      despues: A("https://instagram.com/tallerelnorte"),
      fuentes: [null, "Taller El Norte. Instagram: tallerelnorte"],
    });
    expect(r).toEqual([]);
  });

  it("no repite la misma cuenta dos veces aunque aparezca en el pie y en la cabecera", () => {
    const dos = A("https://instagram.com/inventada") + A("https://instagram.com/inventada");
    const r = enlacesInventados({ antes: "<h1>x</h1>", despues: dos, fuentes: ["pon mi instagram"] });
    expect(r).toHaveLength(1);
  });

  it("href=\"#\" es la salida CORRECTA de la regla y no se penaliza", () => {
    const r = enlacesInventados({
      antes: "<h1>x</h1>",
      despues: A("#"),
      fuentes: ["agrégame un botón de TikTok"],
    });
    expect(r).toEqual([]);
  });
});
