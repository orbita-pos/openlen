import { describe, expect, it } from "vitest";
import { diagnosticosDeLaEscritura } from "./diagnosticos-de-la-escritura";

const pagina = (cuerpo: string, head = "") =>
  ["<!doctype html>", "<html>", `<head><title>T</title>${head}</head>`, "<body>", cuerpo, "</body>", "</html>"].join("\n");

const escritura = (over: Partial<Parameters<typeof diagnosticosDeLaEscritura>[0]>) =>
  diagnosticosDeLaEscritura({
    ruta: "/index.html",
    antes: pagina("<p>hola</p>"),
    despues: pagina("<p>hola</p>"),
    fuentes: [],
    ...over,
  });

describe("diagnosticosDeLaEscritura: lo que antes era un aviso_critico, anclado a línea", () => {
  it("sin nada nuevo, nada: una escritura sana no cuesta un token", () => {
    expect(escritura({})).toEqual([]);
  });

  it("un enlace que dice un número y marca otro, NUEVO: Warning en el href", () => {
    const antes = pagina('<a href="tel:5511112222">55 1111 2222</a>');
    const despues = pagina('<a href="tel:5511112222">55 3333 4444</a>');
    const ds = escritura({ antes, despues });
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ linea: 5, columna: 4, gravedad: "Warning", codigo: "enlace-desfasado" });
    expect(ds[0]!.mensaje).toContain("tel:5511112222");
  });

  // 🔴 H6. Control del 26/09 (encargo-grande #3): un Edit metió un `+` delante
  // del `?` y Len pasó ~90 pasos a ciegas. Como el `[Line L:C]` del
  // `<new-diagnostics>` de Claude Code: la línea y la columna del FICHERO.
  it("🔴 un Edit que deja el <script> sin poder leerse: Error en la línea y columna exactas del fichero", () => {
    const script = (condicion: string) => pagina(`<script>\nvar a = 1;\nvar b = ${condicion} ? 1 : 2;\n</script>`);
    const ds = escritura({ antes: script("a > 0"), despues: script("a > 0 +") });
    const d = ds.find((x) => x.codigo === "js-no-compila");
    expect(d).toMatchObject({ linea: 7, columna: 17, gravedad: "Error" });
    expect(d!.mensaje).toContain("Unexpected token '?'");
  });

  it("con el código en la misma línea que <script>, la columna cuenta desde el principio de la línea", () => {
    const ds = escritura({ despues: pagina("<script>var b = 1 + ? 2 : 3;</script>") });
    expect(ds.find((x) => x.codigo === "js-no-compila")).toMatchObject({ linea: 5, columna: 21 });
  });

  // BRAZO DE CONTROL: nada que el navegador sí lea sale como roto.
  it("CONTRA-PRUEBA: un script sano, un bloque de datos JSON, un módulo o uno con src no dan nada", () => {
    const despues = pagina(
      [
        "<script>document.querySelectorAll('.x').forEach(function (b) { b.addEventListener('click', () => {}); });</script>",
        '<script type="application/json" data-ol-stores>{"menu":{"visitante":"lectura"}}</script>',
        '<script type="module">import x from "./x.js"; export default x;</script>',
        '<script src="https://cdn.tailwindcss.com"></script>',
      ].join("\n"),
    );
    expect(escritura({ despues }).filter((d) => d.codigo === "js-no-compila")).toEqual([]);
  });

  it("CONTRA-PRUEBA: un script que YA venía roto no se repite en cada escritura (la base)", () => {
    const roto = "<script>var b = 1 + ? 2 : 3;</script>";
    expect(escritura({ antes: pagina(roto), despues: pagina(`<h1>Otro</h1>\n${roto}`) })).toEqual([]);
  });

  it("CONTRA-PRUEBA: el mismo enlace torcido que YA venía no se le dice (la base), aunque se corran las líneas", () => {
    const antes = pagina('<a href="tel:5511112222">55 3333 4444</a>');
    const despues = pagina('<h1>Nuevo</h1>\n<a href="tel:5511112222">55 3333 4444</a>');
    expect(escritura({ antes, despues })).toEqual([]);
  });

  it("la meta description que anuncia un teléfono que ya no está", () => {
    const head = '\n<meta name="description" content="Llámanos al 55 1111 2222">';
    const antes = pagina("<p>55 1111 2222</p>", head);
    const despues = pagina("<p>55 3333 4444</p>", head);
    const ds = escritura({ antes, despues });
    expect(ds.map((d) => d.codigo)).toContain("meta-desfasada");
    expect(ds.find((d) => d.codigo === "meta-desfasada")).toMatchObject({ linea: 4, columna: 1 });
  });

  it("un dato del dueño que se fue: Warning donde fue el Edit", () => {
    const antes = pagina('<p>hola</p>\n<img src="https://images.openlen.com/fachada.webp" alt="">');
    const despues = pagina("<p>hola</p>\n<p>sin foto</p>");
    const ds = escritura({
      antes,
      despues,
      edit: { old_string: '<img src="https://images.openlen.com/fachada.webp" alt="">', new_string: "<p>sin foto</p>" },
    });
    const d = ds.find((x) => x.codigo === "dato-perdido");
    expect(d).toMatchObject({ linea: 6, columna: 1, gravedad: "Warning" });
    expect(d!.mensaje).toContain("https://images.openlen.com/fachada.webp");
  });

  it("una red social que nadie dio", () => {
    const despues = pagina('<a href="https://instagram.com/tacosdonbeto">IG</a>');
    const ds = escritura({ despues, fuentes: ["pon mis redes"] });
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ linea: 5, codigo: "enlace-inventado" });
    expect(ds[0]!.mensaje).toContain("tacosdonbeto");
  });

  it("una reseña y un precio que nadie dio (H13), anclados a su línea", () => {
    const despues = pagina("<blockquote>«El mejor bar de vinos de la ciudad, sin ninguna duda» — Carmen P.</blockquote>\n<p>Copa de la casa: $95</p>");
    const ds = escritura({ despues, fuentes: ["pon reseñas y la carta"] });
    expect(ds.map((d) => d.codigo).sort()).toEqual(["precio-inventado", "resena-inventada"]);
    expect(ds.find((d) => d.codigo === "resena-inventada")!.mensaje).toContain("El mejor bar de vinos");
    // Brazo de control: lo mismo, dado por el usuario, calla.
    const dados = escritura({ despues, fuentes: ["mi reseña: el mejor bar de vinos de la ciudad, sin ninguna duda. La copa a 95 pesos"] });
    expect(dados.filter((d) => /-inventad[oa]$/.test(d.codigo ?? ""))).toEqual([]);
  });

  it("el país de un teléfono que nadie dio", () => {
    const despues = pagina('<a href="https://wa.me/525512345678">WhatsApp</a>');
    const ds = escritura({ despues, fuentes: ["mi whatsapp es 5512345678"] });
    expect(ds.map((d) => d.codigo)).toEqual(["prefijo-inventado"]);
    expect(ds[0]!.mensaje).toContain("+52");
  });

  it("un Edit que vació lo que reemplazaba", () => {
    const tarjeta =
      '<div class="t"><h3>Básico</h3><p>Lo esencial para empezar tu negocio en línea hoy mismo.</p><ul><li>Una página</li><li>Dominio</li></ul></div>';
    const antes = pagina(tarjeta);
    const despues = pagina('<div class="t"></div>');
    const ds = escritura({ antes, despues, edit: { old_string: tarjeta, new_string: '<div class="t"></div>' } });
    expect(ds.map((d) => d.codigo)).toEqual(["contenido-vaciado"]);
    expect(ds[0]).toMatchObject({ linea: 5, columna: 1 });
  });

  it("una regla CSS nueva que no puede aplicar nunca, en su línea del <style>", () => {
    const antes = pagina('<div class="card">x</div>');
    const despues = pagina('<div class="card">x</div>', "\n<style>\n.card .titulo { color: red }\n</style>");
    const ds = escritura({ antes, despues });
    expect(ds.map((d) => d.codigo)).toEqual(["regla-muerta"]);
    expect(ds[0]).toMatchObject({ linea: 5, columna: 1 });
    expect(ds[0]!.mensaje).toContain(".titulo");
  });

  it("🔴 el script que busca un elemento que ya no existe: Error en la línea donde lo busca", () => {
    const despues = pagina('<p>x</p>\n<script>\nconst c = document.getElementById("carrito");\nc.textContent = "0";\n</script>');
    const ds = escritura({ despues, referenciasRotas: ["carrito"] });
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ linea: 7, columna: 35, gravedad: "Error", codigo: "referencia-rota" });
    expect(ds[0]!.mensaje).toContain("#carrito");
  });

  it("todas llevan la ruta del fichero y la fuente", () => {
    const despues = pagina('<a href="https://instagram.com/x_inventada">IG</a>');
    const [d] = escritura({ ruta: "/menu/index.html", despues });
    expect(d).toMatchObject({ ruta: "/menu/index.html", fuente: "openlen" });
  });
});
