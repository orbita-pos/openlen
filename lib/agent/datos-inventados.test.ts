import { describe, it, expect } from "vitest";
import { datosInventados, textoLeible, unaCifra } from "./datos-inventados";

// Cada caso va en pareja: el dato inventado AVISA (🔴) y el mismo dato, dado,
// CALLA. Un detector que sólo se prueba en rojo acusa a todo el mundo.

const pagina = (cuerpo: string) => `<!doctype html><html><body><main>${cuerpo}</main></body></html>`;
const ANTES = pagina("<h1>Taquería El Güero</h1><p>Tacos al pastor desde la noche.</p>");

describe("unaCifra — una cifra, una sola forma", () => {
  it("miles, decimales y ceros de adorno", () => {
    expect(unaCifra("4.800")).toBe("4800");
    expect(unaCifra("4,800")).toBe("4800");
    expect(unaCifra("4,9")).toBe("4.9");
    expect(unaCifra("450.00")).toBe("450");
    expect(unaCifra("1,200.50")).toBe("1200.5");
  });
});

describe("textoLeible", () => {
  it("separa los nodos: dos celdas no se leen como un solo número", () => {
    expect(textoLeible("<td>450</td><td>500</td>")).toBe("450 500");
  });
  it("no lee el script ni el estilo", () => {
    expect(textoLeible("<p>hola</p><script>const p = 999;</script><style>.a{}</style>")).toBe("hola");
  });
});

describe("datosInventados — precios", () => {
  const conPrecio = pagina("<h1>Taquería El Güero</h1><p>Orden de pastor: $95</p>");

  it("🔴 avisa de un precio que nadie dio", () => {
    const r = datosInventados({ antes: ANTES, despues: conPrecio, fuentes: ["ponme el menú"] });
    expect(r).toEqual([{ tipo: "precio", texto: "$95" }]);
  });
  it("calla si el usuario lo dijo, aunque lo escriba de otra forma", () => {
    expect(datosInventados({ antes: ANTES, despues: conPrecio, fuentes: ["la orden de pastor a 95.00 pesos"] })).toEqual([]);
  });
  it("calla si el precio estaba en otra página del sitio, o en el carrito del script", () => {
    expect(datosInventados({ antes: ANTES, despues: conPrecio, fuentes: ["", "<p>Pastor $95</p>"] })).toEqual([]);
    expect(datosInventados({ antes: ANTES, despues: conPrecio, fuentes: ['<script>const menu=[{n:"pastor",p:95}]</script>'] })).toEqual([]);
  });
  it("calla con un precio que ya estaba en la página: no lo inventó ESTA escritura", () => {
    const antes = pagina("<p>Orden de pastor: $95</p>");
    expect(datosInventados({ antes, despues: conPrecio, fuentes: [] })).toEqual([]);
  });
  it("calla con un total calculado y con el descuento que dijo el usuario", () => {
    const total = pagina("<p>Orden: $150</p><p>Total (3): $450</p>");
    expect(datosInventados({ antes: ANTES, despues: total, fuentes: ["la orden a $150"] })).toEqual([]);
    const oferta = pagina("<p>Antes $200, hoy $180</p>");
    expect(datosInventados({ antes: ANTES, despues: oferta, fuentes: ["cuesta 200 y les bajo 10 %"] })).toEqual([]);
  });
  it("calla con la subida que pidió el usuario, redondeada (sube-todo-diez: 4,20 € → 4,70 €)", () => {
    const antes = pagina("<p>Pan: 4,20 €</p>");
    const despues = pagina("<p>Pan: 4,70 €</p>");
    const pide = "subele un 10% a todos los precios, y redondea para arriba a los 10 centimos";
    expect(datosInventados({ antes, despues, fuentes: [pide] })).toEqual([]);
    // Brazo de control: sin el porcentaje dado, el mismo precio es nuevo.
    expect(datosInventados({ antes, despues, fuentes: ["cambia el precio del pan"] })).toEqual([{ tipo: "precio", texto: "4,70 €" }]);
  });
  it("calla con las opciones de un desplegable: las elige el visitante", () => {
    const filtro = pagina('<select><option>Desde $450.000</option><option>Más de $2.000.000</option></select>');
    expect(datosInventados({ antes: ANTES, despues: filtro, fuentes: [] })).toEqual([]);
  });
  it("🔴 un número del CSS no da por dado un precio (la «Tostada $38» de las grabaciones)", () => {
    const antes = '<html><head><style>.menu{max-width:38rem}</style></head><body><p class="text-[13.5px] mt-38">Menú</p></body></html>';
    const despues = antes.replace("<p", "<p>Tostada: $38</p><p");
    expect(datosInventados({ antes, despues, fuentes: [antes] })).toEqual([{ tipo: "precio", texto: "$38" }]);
    // Y su brazo de control: el mismo número en el TEXTO de otra página sí lo da.
    expect(datosInventados({ antes, despues, fuentes: [antes, "<p>Tostada 38 pesos</p>"] })).toEqual([]);
  });
  it("unas comillas sueltas en el mensaje no se comen el precio que dictó (propiedad-vendida, 25/09)", () => {
    const despues = pagina("<p>Casa Los Fresnos · $6,200,000</p>");
    const mensaje = 'estado: {"nota": "y = \\"sin cerrar\nLO QUE TE PIDE: y bajale a la Casa Los Fresnos a $6,200,000';
    const otraPagina = '<p class="precio" style="x">Casa Nogal</p>';
    expect(datosInventados({ antes: ANTES, despues, fuentes: [mensaje, otraPagina] })).toEqual([]);
  });
  it("calla con el $0 de un carrito vacío", () => {
    expect(datosInventados({ antes: ANTES, despues: pagina("<p>Total: $0</p>"), fuentes: [] })).toEqual([]);
  });
});

describe("datosInventados — cifras que afirman algo del negocio", () => {
  it("🔴 avisa de «más de 4.800 viajeros», «desde 2019» y «4,9 ★ en 312 reseñas»", () => {
    const despues = pagina("<p>Más de 4.800 viajeros felices</p><p>Viajando desde 2019</p><p>4,9 ★ en 312 reseñas</p>");
    const r = datosInventados({ antes: ANTES, despues, fuentes: ["hazme la agencia"] });
    expect(r.map((x) => x.tipo)).toEqual(["cifra", "cifra", "cifra", "cifra"]);
    expect(r.map((x) => x.texto)).toEqual(["desde 2019", "Más de 4.800 viajeros", "4,9 ★", "312 reseñas"]);
  });
  it("calla si las cifras las dio el usuario", () => {
    const despues = pagina("<p>Más de 4.800 viajeros felices</p><p>Viajando desde 2019</p><p>4,9 ★ en 312 reseñas</p>");
    const fuentes = ["llevamos desde 2019, unos 4800 viajeros, tenemos 4.9 en Google con 312 reseñas"];
    expect(datosInventados({ antes: ANTES, despues, fuentes })).toEqual([]);
  });
  it("no ve una afirmación donde no la hay: un paso, un peso, un top o el año del pie", () => {
    const despues = pagina("<p>Paso 3: elige tu salsa</p><p>300 g de carne</p><p>Top 10 de la ciudad</p><footer>© 2026</footer>");
    expect(datosInventados({ antes: ANTES, despues, fuentes: [] })).toEqual([]);
  });
});

describe("datosInventados — reseñas", () => {
  const conResenas = pagina(
    '<section><blockquote>«Me abrieron un vino que no conocía y ahora vengo cada jueves»<br>— Lucía M.</blockquote></section>',
  );

  it("🔴 avisa de una reseña que nadie dio (resenas-que-no-dio #3, 27/09)", () => {
    const r = datosInventados({ antes: ANTES, despues: conResenas, fuentes: ["pon una sección de reseñas"] });
    expect(r).toEqual([{ tipo: "reseña", texto: "Me abrieron un vino que no conocía y ahora vengo cada jueves" }]);
  });
  it("calla si la reseña la dio el usuario, con otra puntuación", () => {
    const fuentes = ['Lucía M. dijo: "me abrieron un vino que no conocía, y ahora vengo cada jueves"'];
    expect(datosInventados({ antes: ANTES, despues: conResenas, fuentes })).toEqual([]);
  });
  it("🔴 avisa también de una cita firmada fuera de un blockquote", () => {
    const despues = pagina("<p>“El mejor bar de vinos de la ciudad, sin ninguna duda” — Carmen P.</p>");
    expect(datosInventados({ antes: ANTES, despues, fuentes: [] }).map((x) => x.tipo)).toEqual(["reseña"]);
  });
  it("calla con unas comillas sin firma: un eslogan no es una reseña", () => {
    const despues = pagina("<h2>“Los tacos que tu abuela aprobaría sin dudarlo”</h2>");
    expect(datosInventados({ antes: ANTES, despues, fuentes: [] })).toEqual([]);
  });
});
