// LA COMPROBACIÓN DEL CARRITO, CON SU BRAZO DE CONTROL.
//
// El control es el carrito que Len construyó en producción el 2026-09-18
// (proyecto «Volcánica»), reducido a lo que importa: guarda en localStorage y
// «sincroniza» mandando un POST por producto a `/api/d/carrito/carrito`, con
// campos sueltos en un almacén `propio`. La comprobación vieja lo daba por
// bueno; ésta tiene que suspenderlo. Y un carrito bien hecho tiene que pasar,
// o la comprobación no mide nada: sólo suspende.
import { describe, expect, it } from "vitest";

import { comprobarCarritoEnNavegador, unidadesGuardadas } from "./carrito-en-navegador";

const PRODUCTOS = `
<article><h3>Chiapas</h3><button class="js-add" data-nombre="Chiapas" data-precio="180">Agregar al carrito</button></article>
<article><h3>Oaxaca</h3><button class="js-add" data-nombre="Oaxaca" data-precio="200">Agregar al carrito</button></article>
<ul id="carrito-lista"></ul>`;

/** El de producción: localStorage + un POST por producto + sin GET. */
function carritoDeLen(sub: string): string {
  return `<!doctype html><html><head><title>Volcánica</title></head><body>
<script type="application/json" data-ol-stores>{"carrito":{"visitante":"propio","campos":{"producto":"texto","precio":"numero","cantidad":"numero"}}}</script>
${PRODUCTOS}
<script>
  var CLAVE = 'volcanica-carrito-v1';
  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE) || '[]'); } catch (e) { return []; } }
  function guardar(items) { try { localStorage.setItem(CLAVE, JSON.stringify(items)); } catch (e) {} sincronizar(items); }
  function sincronizar(items) {
    items.forEach(function (it) {
      fetch('/api/d/${sub}/carrito', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ producto: it.nombre, precio: it.precio, cantidad: it.cantidad }) }).catch(function () {});
    });
  }
  document.querySelectorAll('.js-add').forEach(function (b) {
    b.addEventListener('click', function () {
      var items = leer();
      items.push({ nombre: b.dataset.nombre, precio: Number(b.dataset.precio), cantidad: 1 });
      guardar(items);
    });
  });
</script></body></html>`;
}

/** El correcto: el carrito entero en un campo `lista`, un POST, y GET al cargar. */
function carritoBienHecho(url: string): string {
  return `<!doctype html><html><head><title>Volcánica</title></head><body>
<script type="application/json" data-ol-stores>{"carrito":{"visitante":"propio","campos":{"items":"lista"}}}</script>
${PRODUCTOS}
<script>
  var items = [];
  function pintar() { document.getElementById('carrito-lista').innerHTML = items.map(function (i) { return '<li>' + i.nombre + '</li>'; }).join(''); }
  fetch('${url}').then(function (r) { return r.json(); }).then(function (j) {
    if (j.documentos && j.documentos[0]) { items = j.documentos[0].doc.items || []; pintar(); }
  }).catch(function () {});
  document.querySelectorAll('.js-add').forEach(function (b) {
    b.addEventListener('click', function () {
      items.push({ nombre: b.dataset.nombre, precio: Number(b.dataset.precio), cantidad: 1 });
      pintar();
      fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items }) });
    });
  });
</script></body></html>`;
}

describe("el carrito se prueba usándolo, contra las reglas del servidor real", () => {
  it("CONTROL: el carrito de producción del 18/09 suspende — su subdominio inventado se rechaza", async () => {
    const v = await comprobarCarritoEnNavegador(carritoDeLen("carrito"), { sub: null });
    expect(v.fallo).toMatch(/origen_invalido/);
  }, 60_000);

  it("CONTROL: con el subdominio bueno sigue suspendiendo — un POST por producto deja sólo el último", async () => {
    const v = await comprobarCarritoEnNavegador(carritoDeLen("volcanica"), { sub: "volcanica" });
    expect(v.fallo).toMatch(/la base guarda 1/);
  }, 60_000);

  it("el carrito bien hecho pasa: dos unidades guardadas y las lee al recargar", async () => {
    const v = await comprobarCarritoEnNavegador(carritoBienHecho("/api/d/volcanica/carrito"), { sub: "volcanica" });
    expect(v.fallo).toBeNull();
    expect(v.detalle).toMatch(/unidades guardadas tras 2 clics: 2/);
    expect(v.detalle).toMatch(/lee al recargar: sí/);
  }, 60_000);
});

describe("unidadesGuardadas", () => {
  it("una lista cuenta sus elementos, o su cantidad", () => {
    expect(unidadesGuardadas([{ doc: { items: [{ a: 1 }, { a: 2 }] } }])).toBe(2);
    expect(unidadesGuardadas([{ doc: { items: [{ cantidad: 3 }] } }])).toBe(3);
  });
  it("un documento suelto cuenta 1, o su cantidad", () => {
    expect(unidadesGuardadas([{ doc: { producto: "x" } }])).toBe(1);
    expect(unidadesGuardadas([{ doc: { producto: "x", cantidad: 2 } }])).toBe(2);
  });
});
