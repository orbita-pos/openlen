import { describe, expect, it } from "vitest";

import { activoDelSitio, codigoNuevo, loActivo, newCodeInFolderFile } from "./javascript-del-usuario";

const PAGINA = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head>
<body><h1>Casa Oleaje</h1><button onclick="abrir()">Reserva</button>
<script>function abrir(){ document.body.classList.add("x") }</script></body></html>`;
const MENU = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><h1>Menú</h1></body></html>`;
const SITIO = activoDelSitio([PAGINA, MENU]);

describe("codigoNuevo — la terminal del usuario no mete código que el sitio no tenía", () => {
  it("cambiar el texto, los estilos o un enlace normal se guarda", () => {
    expect(codigoNuevo(PAGINA.replace("Casa Oleaje", "Casa Oleaje Sayulita"), SITIO)).toBeNull();
    expect(codigoNuevo(PAGINA.replace("<h1>", '<h1 class="text-5xl">'), SITIO)).toBeNull();
    expect(codigoNuevo(PAGINA.replace("</h1>", '</h1><a href="/contacto/">Contacto</a>'), SITIO)).toBeNull();
  });

  it("copiar una página entera, mover lo activo o quitarlo se guarda: no entra código nuevo", () => {
    expect(codigoNuevo(PAGINA, SITIO)).toBeNull();
    expect(codigoNuevo(MENU.replace("</h1>", '</h1><button onclick="abrir()">Reserva</button>'), SITIO)).toBeNull();
    expect(codigoNuevo(PAGINA.replace(/<script>function[\s\S]*?<\/script>/, ""), SITIO)).toBeNull();
  });

  it.each([
    ["añadir un <script>", PAGINA.replace("</body>", "<script>alert(1)</script></body>")],
    ["cambiar el código de un <script>", PAGINA.replace('add("x")', 'add("y")')],
    ["cambiar el CDN", PAGINA.replace("cdn.tailwindcss.com", "evil.example")],
    ["añadir un on…", PAGINA.replace("<h1>", '<h1 onmouseover="robar()">')],
    ["cambiar un on…", PAGINA.replace('onclick="abrir()"', 'onclick="robar()"')],
    ["un javascript:", PAGINA.replace("</h1>", '</h1><a href="javascript:robar()">x</a>')],
    ["un javascript: con entidades", PAGINA.replace("</h1>", '</h1><a href="jav&#x61;script&colon;robar()">x</a>')],
    ["un javascript: con un tabulador dentro", PAGINA.replace("</h1>", '</h1><a href="java\tscript:robar()">x</a>')],
    ["un iframe", PAGINA.replace("</h1>", '</h1><iframe src="https://evil.example"></iframe>')],
    ["un meta refresh", PAGINA.replace("<head>", '<head><meta http-equiv="refresh" content="0;url=https://evil.example">')],
    ["un <svg> con onload", PAGINA.replace("</h1>", "</h1><svg onload=robar()></svg>")],
    ["un ON en mayúsculas", PAGINA.replace("<h1>", '<h1 ONMOUSEOVER="robar()">')],
  ])("%s no se guarda", (_, despues) => {
    expect(codigoNuevo(despues, SITIO)).toMatch(/JavaScript .* cannot be added or changed by hand/);
  });

  it("lo activo se compara sin disfraces y en orden estable", () => {
    expect(loActivo('<a href="JAV&#65;SCRIPT:x">')).toEqual(loActivo('<a href="javascript:x">'));
  });
});

// LA CARPETA (pieza 9 de Len 2.5): la misma regla para los ficheros. Un .js es
// código entero; un .svg puede llevarlo dentro. Datos, CSS y texto, libres.
describe("newCodeInFolderFile — el dueño no mete código a mano en la carpeta", () => {
  const antes = { "/js/app.js": "console.log(1)", "/data/menu.json": "[]", "/index.html": PAGINA };

  it("🔴 cambiar o crear un .js/.mjs, no", () => {
    expect(newCodeInFolderFile("/js/app.js", "console.log(2)", antes)).toMatch(/Len's job/);
    expect(newCodeInFolderFile("/js/nuevo.mjs", "export {}", antes)).toMatch(/Len's job/);
  });

  it("copiarlo o moverlo (el mismo contenido que uno guardado), sí", () => {
    expect(newCodeInFolderFile("/js/copia.js", "console.log(1)", antes)).toBeNull();
  });

  it("🔴 un .svg con script o con on…, no; uno inerte, sí", () => {
    expect(newCodeInFolderFile("/img/a.svg", '<svg onload="x()"></svg>', antes)).toMatch(/Len's job/);
    expect(newCodeInFolderFile("/img/a.svg", "<svg><script>x()</script></svg>", antes)).toMatch(/Len's job/);
    expect(newCodeInFolderFile("/img/a.svg", '<svg><circle r="4"/></svg>', antes)).toBeNull();
  });

  it("los datos, el CSS, el texto y las pruebas, libres", () => {
    expect(newCodeInFolderFile("/data/menu.json", "[1]", antes)).toBeNull();
    expect(newCodeInFolderFile("/css/a.css", "body{color:red}", antes)).toBeNull();
    expect(newCodeInFolderFile("/README.md", "# hola", antes)).toBeNull();
    expect(newCodeInFolderFile("/tests/a.spec.ts", "test('x', async () => {})", antes)).toBeNull();
  });
});
