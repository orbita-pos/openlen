import { describe, it, expect } from "vitest";
import {
  aceptarReparacion,
  contarEncabezados,
  contarElementosConTextoVisible,
  reparacionConservaContenido,
  textoVisible,
} from "./repair-guard";

// El caso REAL que originó este guardián: PULSE ATHLETICS, 2026-08-24. El
// defecto medido era `.hover-zoom .card-img` no aplica NUNCA, y la reparación
// lo "arregló" vaciando los envoltorios que llevaban esas clases.
const ANTES = `<!doctype html><html><head><style>.x{color:red}</style></head><body>
  <section class="hero">
    <div class="max-w-2xl">
      <div class="fade-up">
        <h1>SUPERA TUS LÍMITES</h1>
        <p>La nueva colección llega para acompañarte en cada kilómetro.</p>
        <a href="#tienda">Comprar ahora</a>
      </div>
    </div>
  </section>
  <section><h2>Categorías</h2><a class="hover-zoom"><div class="card-img"></div>Running</a></section>
</body></html>`;

const REPARADA_VACIANDO = `<!doctype html><html><head><style>.x{color:red}</style></head><body>
  <section class="hero">
    <div class="max-w-2xl">
      <div class="fade-up visible">
      </div>
    </div>
  </section>
  <section><a class="hover-zoom"><div class="card-img"></div>Running</a></section>
</body></html>`;

const REPARADA_DE_VERDAD = ANTES.replace(
  '<a class="hover-zoom"><div class="card-img">',
  '<a class="hover-zoom"><div class="card-img" style="background:#111">',
);

describe("textoVisible", () => {
  it("no cuenta lo que hay dentro de <style> ni <script>", () => {
    const t = textoVisible(`<style>.x{color:red}</style><p>hola</p><script>var a=1;</script>`);
    expect(t).toBe("hola");
  });

  it("no cuenta los comentarios", () => {
    expect(textoVisible(`<!--email_off--><p>hola</p><!--/email_off-->`)).toBe("hola");
  });
});

describe("contarEncabezados", () => {
  it("cuenta los seis niveles y no se traga otras etiquetas", () => {
    expect(contarEncabezados("<h1>a</h1><h3>b</h3><header>c</header><hr>")).toBe(2);
  });

  it("ignora encabezados en las cinco zonas no visibles y los custom elements", () => {
    const html = `<!-- <h1>comentario</h1> --><script><h2>script</h2></script><style><h3>style</h3></style><template><h4>template</h4></template><noscript><h5>noscript</h5></noscript><h1-widget>no</h1-widget><h6>visible</h6>`;

    expect(contarEncabezados(html)).toBe(1);
  });
});

describe("contarElementosConTextoVisible", () => {
  it("ignora los nodos no visibles y cuenta los elementos que contienen texto", () => {
    expect(
      contarElementosConTextoVisible(
        "<main><p>Hola <strong>mundo</strong></p><script>texto falso</script><template>plantilla</template><!--nota--></main>",
      ),
    ).toBe(3);
  });

  it("trata script y style como raw-text aunque incluyan etiquetas literales", () => {
    const antes = `<script>const plantilla = "<template><h2>falso</h2></template>";</script><style>.x::after{content:"<noscript><h3>falso</h3></noscript>"}</style><body><h1>Título visible</h1><p>Párrafo visible</p></body>`;
    const despues = `<script>const plantilla = "<template><h2>falso</h2></template>";</script><style>.x::after{content:"<noscript><h3>falso</h3></noscript>"}</style>`;

    expect(textoVisible(antes)).toBe("Título visible Párrafo visible");
    expect(contarEncabezados(antes)).toBe(1);
    expect(contarElementosConTextoVisible(antes)).toBe(3);
    expect(reparacionConservaContenido(antes, despues).ok).toBe(false);
  });

  it("trata un > entre comillas como marcado, no como texto visible", () => {
    const antes = '<section data-copy="a > b"><p>hola</p></section>';
    const despues = '<section data-copy="c > d"><p>hola</p></section>';

    expect(textoVisible(antes)).toBe("hola");
    expect(contarElementosConTextoVisible(antes)).toBe(2);
    expect(reparacionConservaContenido(antes, despues)).toEqual({ ok: true });
  });
});

describe("reparacionConservaContenido", () => {
  // 🔴 EL BRAZO DE CONTROL. Sin esta prueba el guardián podría no comprobar
  // nada y pasar en verde igual.
  it("RECHAZA la reparación real que vació la tienda", () => {
    const v = reparacionConservaContenido(ANTES, REPARADA_VACIANDO);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toMatch(/texto|encabezados/);
  });

  it("dice CUÁNTO se perdió, no sólo que se perdió", () => {
    const v = reparacionConservaContenido(ANTES, REPARADA_VACIANDO);
    if (!v.ok) expect(v.motivo).toMatch(/\d+/);
    else throw new Error("debería haber fallado");
  });

  it("acepta una reparación que sólo toca marcado", () => {
    expect(reparacionConservaContenido(ANTES, REPARADA_DE_VERDAD)).toEqual({ ok: true });
  });

  it("acepta que la reparación AÑADA texto", () => {
    const mas = ANTES.replace("</body>", "<p>Envío gratis desde 50 €.</p></body>");
    expect(reparacionConservaContenido(ANTES, mas)).toEqual({ ok: true });
  });

  it("un encabezado menos se rechaza aunque el texto se conserve entero", () => {
    const sinTitulo = ANTES.replace("<h1>SUPERA TUS LÍMITES</h1>", "<div>SUPERA TUS LÍMITES</div>");
    const v = reparacionConservaContenido(ANTES, sinTitulo);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("encabezados");
  });

  it("rechaza menos del 90% exacto aun con texto corto", () => {
    const antes = "<p>abcdefghij</p>";
    const limiteExacto = "<p>abcdefghi</p>";
    const porDebajo = "<p>abcdefgh</p>";

    expect(reparacionConservaContenido(antes, limiteExacto).ok).toBe(true);
    expect(reparacionConservaContenido(antes, porDebajo).ok).toBe(false);
  });

  it("rechaza perder elementos con texto aunque conserve caracteres y encabezados", () => {
    const antes = "<section><h1>Título</h1><p>uno</p><p>dos</p></section>";
    const despues = "<section><h1>Título</h1><p>uno dos</p></section>";

    const v = reparacionConservaContenido(antes, despues);

    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("elementos con texto");
  });

  it("un documento que ya venía sin texto no bloquea nada", () => {
    expect(reparacionConservaContenido("<body></body>", "<body><p>hola</p></body>")).toEqual({
      ok: true,
    });
  });
});

describe("aceptarReparacion", () => {
  // Esta prueba debe fallar si la ruta deja de exigir que la reparación
  // conserve contenido, aunque el motor vea menos defectos.
  it("descarta en la puerta de /api/generate una reparación destructiva que reduce defectos", () => {
    const decision = aceptarReparacion({
      htmlAntes: ANTES,
      htmlDespues: REPARADA_VACIANDO,
      motorValido: true,
      defectosAntes: 3,
      defectosDespues: 1,
    });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.motivo).toMatch(/texto|encabezados|elementos con texto/);
  });

  it("acepta en la misma puerta una reparación válida que mejora y conserva el documento", () => {
    expect(
      aceptarReparacion({
        htmlAntes: ANTES,
        htmlDespues: REPARADA_DE_VERDAD,
        motorValido: true,
        defectosAntes: 3,
        defectosDespues: 1,
      }),
    ).toEqual({ ok: true });
  });
});
