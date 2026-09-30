import { describe, expect, it } from "vitest";

import { clasesQueConoceTailwind } from "./clases-de-tailwind";
import { clasesQueElScriptPoneSinEstilo, type ConoceTailwind } from "./css-wiring";

// LAS DOS MITADES: el script pone una clase y ningún estilo la pinta. El control
// corre, no lanza, y no cambia nada en pantalla.

const TW = `<script src="https://cdn.tailwindcss.com"></script>`;
const pagina = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

// Un Tailwind de mentira para las pruebas del detector: conoce lo que se le da.
const conoce =
  (...clases: string[]): ConoceTailwind =>
  (lista) =>
    new Set(lista.filter((c) => clases.includes(c)));
const nadie: ConoceTailwind = () => new Set();

const clases = (html: string, tw: ConoceTailwind = nadie) => clasesQueElScriptPoneSinEstilo(html, tw).map((x) => x.clase);

describe("caza el estado que nadie pinta", () => {
  it("el menú que se abre con una clase que ninguna regla define", () => {
    const html = pagina(
      `${TW}<style>.menu{display:none}</style>`,
      `<button id="b">Menú</button><nav class="menu"></nav><script>b.addEventListener("click",()=>document.querySelector("nav").classList.toggle("open"))</script>`,
    );
    expect(clases(html)).toEqual(["open"]);
  });

  it("también en un `on*` del marcado, que Len ya puede escribir", () => {
    const html = pagina(`<style>.menu{display:none}</style>`, `<button onclick="this.nextElementSibling.classList.toggle('open')">Menú</button><nav class="menu"></nav>`);
    expect(clases(html)).toEqual(["open"]);
  });

  it("add con varias, className y setAttribute", () => {
    const html = pagina(
      `<style>.a{color:red}</style>`,
      `<p id="p" class="a"></p><script>p.classList.add("a","b");p.className="a c";p.setAttribute("class","a d")</script>`,
    );
    expect(clases(html)).toEqual(["b", "c", "d"]);
  });

  it("toggle: sólo la clase, no las cadenas de la condición", () => {
    const html = pagina(`<style></style>`, `<p id="p"></p><script>p.classList.toggle("open", modo === "grande")</script>`);
    expect(clases(html)).toEqual(["open"]);
  });

  it("replace: la nueva, no la que se va", () => {
    const html = pagina(`<style>.vieja{color:red}</style>`, `<p id="p" class="vieja"></p><script>p.classList.replace("vieja","nueva")</script>`);
    expect(clases(html)).toEqual(["nueva"]);
  });

  it("una clase de Tailwind en una página SIN Tailwind no pinta nada", () => {
    const html = pagina(`<style></style>`, `<p id="p"></p><script>p.classList.add("hidden")</script>`);
    expect(clases(html, conoce("hidden"))).toEqual(["hidden"]);
  });

  it("señala dónde la pone el script", () => {
    const html = pagina(`<style></style>`, `<p id="p"></p><script>p.classList.add("open")</script>`);
    const [x] = clasesQueElScriptPoneSinEstilo(html, nadie);
    expect(html.slice(x.indice)).toMatch(/^open"\)/);
  });
});

describe("no acusa lo que sí se usa", () => {
  it("la regla existe, también compuesta o dentro de un @media", () => {
    const html = pagina(
      `<style>.menu.open{display:block}@media (min-width:640px){.tab.activa{font-weight:700}}</style>`,
      `<nav class="menu"></nav><script>n.classList.toggle("open");t.classList.add("activa")</script>`,
    );
    expect(clases(html)).toEqual([]);
  });

  it("Tailwind la conoce y la página lo carga", () => {
    const html = pagina(TW, `<p id="p"></p><script>p.classList.toggle("hidden");p.classList.add("rotate-180")</script>`);
    expect(clases(html, conoce("hidden", "rotate-180"))).toEqual([]);
  });

  it("el script la lee: es una marca de estado, no un estilo", () => {
    const html = pagina(
      `<style></style>`,
      `<script>a.classList.add("elegida");if(a.classList.contains("elegida")){};b.classList.add("marcada");document.querySelectorAll(".lista .marcada").length</script>`,
    );
    expect(clases(html)).toEqual([]);
  });

  it("el CSS lo inyecta el propio script", () => {
    const html = pagina(`<style></style>`, `<script>const s=document.createElement("style");s.textContent=".open{display:block}";p.classList.add("open")</script>`);
    expect(clases(html)).toEqual([]);
  });

  it("un selector de atributo la nombra", () => {
    const html = pagina(`<style>[class~="open"]{display:block}</style>`, `<script>p.classList.add("open")</script>`);
    expect(clases(html)).toEqual([]);
  });

  it("lo que se compara no es una clase (el falso aviso de la pasada del 29/09)", () => {
    const html = pagina(
      `<style>.cart-note.is-error{color:red}.cart-note.is-ok{color:green}</style>`,
      `<p id="n" class="cart-note"></p><script>n.className = "cart-note " + (kind === "error" ? "is-error" : kind === "ok" ? "is-ok" : "");p.className = lista.includes("x") ? "cart-note" : "cart-note"</script>`,
    );
    expect(clases(html)).toEqual([]);
  });

  it("lo que se construye al ejecutar no se puede afirmar", () => {
    const html = pagina(`<style></style>`, "<script>p.classList.add(`is-${x}`);q.classList.add(\"is-\" + y);r.className = \"tarjeta \" + estado</script>");
    expect(clases(html)).toEqual([]);
  });

  it("con una hoja que no podemos leer, no se afirma nada", () => {
    const html = pagina(
      `<link rel="stylesheet" href="https://libs.openlen.com/swiper/12.2.0/swiper-bundle.min.css"><style></style>`,
      `<script>p.classList.add("swiper-slide-visible")</script>`,
    );
    expect(clases(html)).toEqual([]);
  });

  it("Google Fonts sí se sabe qué es: no define clases", () => {
    const html = pagina(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style></style>`, `<script>p.classList.add("open")</script>`);
    expect(clases(html)).toEqual(["open"]);
  });

  it("si el compilador no contesta, calla", () => {
    const html = pagina(TW, `<script>p.classList.add("open")</script>`);
    const roto: ConoceTailwind = () => {
      throw new Error("sin tailwind");
    };
    expect(clases(html, roto)).toEqual([]);
  });

  it("los bloques que no son JavaScript no cuentan", () => {
    const html = pagina(`<style></style>`, `<script type="application/json" data-ol-stores>{"x":"p.classList.add('open')"}</script>`);
    expect(clases(html)).toEqual([]);
  });
});

describe("el compilador de verdad", () => {
  it("Tailwind v3 contesta con el theme.extend de la página", () => {
    const r = clasesQueConoceTailwind(["open", "hidden", "rotate-180", "bg-marca", "show"], { colors: { marca: "#123456" } });
    expect([...r].sort()).toEqual(["bg-marca", "hidden", "rotate-180"]);
  });

  it("sin el extend, el color de la página no existe", () => {
    expect(clasesQueConoceTailwind(["bg-marca"], null).size).toBe(0);
  });
});
