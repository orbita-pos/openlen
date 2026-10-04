import { describe, it, expect } from "vitest";
import { libreriasQueNoCargan } from "./librerias-que-no-cargan";

// En pareja, como sus hermanos: lo que no carga AVISA (🔴) y lo que carga CALLA.

const CHART = "https://libs.openlen.com/chart.js/4.5.0/chart.umd.min.js";
const SWIPER_JS = "https://libs.openlen.com/swiper/12.2.0/swiper-bundle.min.js";
const SWIPER_CSS = "https://libs.openlen.com/swiper/12.2.0/swiper-bundle.min.css";
const PS_NUCLEO = "https://libs.openlen.com/photoswipe/5.4.4/photoswipe.umd.min.js";
const PS_LIGHTBOX = "https://libs.openlen.com/photoswipe/5.4.4/photoswipe-lightbox.umd.min.js";

const doc = (head: string, js = "") =>
  `<!doctype html><html><head>${head}</head><body><canvas id="g"></canvas>${js ? `<script>${js}</script>` : ""}</body></html>`;
const tipos = (html: string) => libreriasQueNoCargan(html).map((x) => x.tipo);

describe("libreriasQueNoCargan", () => {
  // Lo que escribe el modelo llega tal cual a la publicada (medido el
  // 2026-10-04 con supabase-js de jsDelivr): un CDN que no es el nuestro CARGA.
  it("🔴 un script de jsDelivr o unpkg calla, y su `new Chart` no cuenta como «sin cargar»", () => {
    expect(tipos(doc('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'))).toEqual([]);
    expect(tipos(doc('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>', "new Chart(g, {})"))).toEqual([]);
    expect(tipos(doc('<script src="https://unpkg.com/swiper/swiper-bundle.min.js"></script>', "new Swiper('.s', {})"))).toEqual([]);
    // BRAZO DE CONTROL: sin cargarla de ningún sitio, sí avisa.
    expect(tipos(doc("", "new Chart(g, {})"))).toEqual(["sin-cargar"]);
  });
  it("la etiqueta exacta del catálogo calla", () => {
    expect(tipos(doc(`<script src="${CHART}"></script>`, "new Chart(g, {})"))).toEqual([]);
  });
  it("🔴 con integrity o crossorigin, el navegador la bloquea", () => {
    expect(tipos(doc(`<script src="${CHART}" integrity="sha384-x" crossorigin="anonymous"></script>`, "new Chart(g, {})"))).toEqual(["con-integrity"]);
    expect(tipos(doc(`<script src="${CHART}" crossorigin></script>`, "new Chart(g, {})"))).toEqual(["con-integrity"]);
  });
  it("🔴 una versión que no está en el catálogo", () => {
    const otra = "https://libs.openlen.com/chart.js/4.4.0/chart.umd.min.js";
    expect(tipos(doc(`<script src="${otra}"></script>`))).toEqual(["fuera-del-catalogo"]);
  });
  it("🔴 el script usa Chart y la página no la carga", () => {
    expect(tipos(doc("", "new Chart(g, {})"))).toEqual(["sin-cargar"]);
  });
  it("no ve un uso donde no lo hay", () => {
    expect(tipos(doc("", "const chart = document.querySelector('#g'); chart.dataset.x = 1;"))).toEqual([]);
  });
  it("🔴 PhotoSwipe necesita sus DOS scripts; con los dos, calla", () => {
    const js = "new PhotoSwipeLightbox({ gallery: '.g', children: 'a', pswpModule: PhotoSwipe }).init()";
    const r = libreriasQueNoCargan(doc(`<script src="${PS_LIGHTBOX}"></script>`, js));
    expect(r.map((x) => x.tipo)).toEqual(["sin-cargar"]);
    expect(r[0]!.tipo === "sin-cargar" && r[0]!.faltan).toEqual([PS_NUCLEO]);
    expect(tipos(doc(`<script src="${PS_NUCLEO}"></script><script src="${PS_LIGHTBOX}"></script>`, js))).toEqual([]);
  });
  it("🔴 Swiper sin su hoja se apila en vertical; con la hoja, calla", () => {
    const js = "new Swiper('.s', {})";
    expect(tipos(doc(`<script src="${SWIPER_JS}"></script>`, js))).toEqual(["sin-hoja"]);
    expect(tipos(doc(`<script src="${SWIPER_JS}"></script><link rel="stylesheet" href="${SWIPER_CSS}">`, js))).toEqual([]);
  });
  it("Tailwind y Google Fonts no son asunto suyo", () => {
    const head = '<script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syne">';
    expect(tipos(doc(head))).toEqual([]);
  });
});
