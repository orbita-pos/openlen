import { describe, it, expect } from "vitest";
import { libreriasQueNoCargan, scriptSobreviveAlPublicar } from "./librerias-que-no-cargan";

// En pareja, como sus hermanos: lo que se rompe al publicar AVISA (🔴) y la
// etiqueta exacta del catálogo CALLA.

const CHART = "https://libs.openlen.com/chart.js/4.5.0/chart.umd.min.js";
const SWIPER_JS = "https://libs.openlen.com/swiper/12.2.0/swiper-bundle.min.js";
const SWIPER_CSS = "https://libs.openlen.com/swiper/12.2.0/swiper-bundle.min.css";
const PS_NUCLEO = "https://libs.openlen.com/photoswipe/5.4.4/photoswipe.umd.min.js";
const PS_LIGHTBOX = "https://libs.openlen.com/photoswipe/5.4.4/photoswipe-lightbox.umd.min.js";

const doc = (head: string, js = "") =>
  `<!doctype html><html><head>${head}</head><body><canvas id="g"></canvas>${js ? `<script>${js}</script>` : ""}</body></html>`;
const tipos = (html: string) => libreriasQueNoCargan(html).map((x) => x.tipo);

describe("scriptSobreviveAlPublicar — el espejo de scripts.rs", () => {
  it("Tailwind y nuestras librerías sobreviven; lo demás, no", () => {
    expect(scriptSobreviveAlPublicar("https://cdn.tailwindcss.com")).toBe(true);
    expect(scriptSobreviveAlPublicar("https://cdn.tailwindcss.com?plugins=forms")).toBe(true);
    expect(scriptSobreviveAlPublicar(CHART)).toBe(true);
    expect(scriptSobreviveAlPublicar("https://cdn.jsdelivr.net/npm/chart.js")).toBe(false);
    expect(scriptSobreviveAlPublicar("http://cdn.tailwindcss.com")).toBe(false);
    expect(scriptSobreviveAlPublicar("https://cdn.tailwindcss.com.evil.example/x.js")).toBe(false);
    expect(scriptSobreviveAlPublicar("/app.js")).toBe(false);
  });
});

describe("libreriasQueNoCargan", () => {
  it("🔴 un Chart.js de jsDelivr se borra al publicar, y se le ofrece el nuestro", () => {
    const r = libreriasQueNoCargan(doc('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>', "new Chart(g, {})"));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: "script-ajeno", src: "https://cdn.jsdelivr.net/npm/chart.js" });
    expect(r[0]!.tipo === "script-ajeno" && r[0]!.sustituta?.id).toBe("chart.js");
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
