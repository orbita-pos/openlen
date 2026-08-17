import { describe, expect, it } from "vitest";

import { looksLikeNavbar, sectionMarkup } from "./section-shape";

const NAVBAR = `<link href="https://fonts.googleapis.com/css2?family=Oswald" rel="stylesheet">
<style>[data-sec="x"]{--bg:#08090C}</style>
<header data-sec="x" class="sticky top-0 z-40">
  <div class="wrap flex items-center justify-between">
    <a href="#top">CENIT</a>
    <nav class="hidden md:flex">
      <a href="#capacidades">Capacidades</a>
      <a href="#servicios">Servicios</a>
      <a href="#contacto">Contacto</a>
    </nav>
  </div>
</header>`;

const HERO = `<style>[data-sec="y"]{--bg:#fff}</style>
<section data-sec="y">
  <h1>Tostado en Guadalajara, servido en tu taza</h1>
  <p>Grano fresco de origen, tostado en lotes pequeños.</p>
  <a href="#grano">Ver grano</a><a href="#catas">Catas</a><a href="#sub">Suscripción</a>
</section>`;

describe("qué es una sección, leído de su forma", () => {
  it("reconoce una barra de navegación aunque diga que es un hero", () => {
    expect(looksLikeNavbar(NAVBAR)).toBe(true);
  });

  it("no toca un hero de verdad, por muchos enlaces que tenga", () => {
    expect(looksLikeNavbar(HERO)).toBe(false);
  });

  it("un titular basta para no ser barra", () => {
    const withHeading = NAVBAR.replace("<a href=\"#top\">CENIT</a>", "<h2>CENIT</h2><a href=\"#top\">CENIT</a>");
    expect(looksLikeNavbar(withHeading)).toBe(false);
  });

  it("sin <nav> no es barra, por conservador", () => {
    expect(looksLikeNavbar(NAVBAR.replace(/<\/?nav[^>]*>/g, ""))).toBe(false);
  });

  it("dos enlaces sueltos no hacen una barra", () => {
    const thin = '<div><nav><a href="#a">A</a><a href="#b">B</a></nav></div>';
    expect(looksLikeNavbar(thin)).toBe(false);
  });

  it("no se deja engañar por un titular escrito dentro del CSS", () => {
    const cssOnly = '<style>h1{font-size:3rem}</style><header><nav><a href="#a">A</a><a href="#b">B</a><a href="#c">C</a></nav></header>';
    expect(looksLikeNavbar(cssOnly)).toBe(true);
  });

  it("un cuerpo vacío no es nada", () => {
    expect(looksLikeNavbar("")).toBe(false);
    expect(looksLikeNavbar("<style>a{}</style>")).toBe(false);
  });

  it("el marcado sale sin estilos ni fuentes", () => {
    expect(sectionMarkup(NAVBAR)).not.toMatch(/<style|<link/i);
    expect(sectionMarkup(NAVBAR)).toMatch(/^<header/);
  });
});
