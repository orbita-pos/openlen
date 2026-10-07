// @vitest-environment node
// Con lo que nace una app (H10): tiene que compilar y arrancar tal cual, y lo
// que trae es lo que el manual de Len dice que hay.
import { describe, expect, it } from "vitest";
import { compilarCarpeta, textoDeDiagnostico } from "./compilador";
import { CATALOGO_ACTUAL } from "./dependencias";
import { ENTRADA, esqueletoDeApp } from "./esqueleto";
import { problemasDelCascaron } from "@/lib/agent/compila-la-app";
import { buildManualDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";

describe("el esqueleto de una app", () => {
  const e = esqueletoDeApp({ titulo: "Caja del Café", idioma: "es" });

  it("🔴 compila entero y el cascarón la arranca", () => {
    const r = compilarCarpeta({ carpeta: e.ficheros, catalogo: e.app.catalogo, entrada: e.app.entrada });
    expect(r.errores.map(textoDeDiagnostico)).toEqual([]);
    expect(r.grafo).toEqual(["/src/App.jsx", "/src/main.jsx", "/src/screens/Inicio.jsx"]);
    expect(problemasDelCascaron(e.app, e.html, e.ficheros)).toEqual([]);
  });

  it("es una app del catálogo actual, que empieza en su entrada", () => {
    expect(e.app).toEqual({ catalogo: CATALOGO_ACTUAL, entrada: ENTRADA });
    expect(e.html).toContain('<html lang="es">');
    expect(e.html).toContain("<title>Caja del Café</title>");
    expect(e.html).toContain('<script src="https://cdn.tailwindcss.com"></script>');
  });

  it("el cliente del backend lee import.meta.env: ninguna clave escrita", () => {
    expect(e.ficheros["/src/lib/supabase.js"]).toContain("import.meta.env.VITE_SUPABASE_URL");
    expect(e.ficheros["/src/lib/supabase.js"]).not.toMatch(/sb_|https:\/\//);
  });

  it("un título con comillas o etiquetas no rompe ni el cascarón ni el JSX", () => {
    const raro = esqueletoDeApp({ titulo: '<script>alert("x")</script> & "Cía"' });
    expect(raro.html).toContain("<title>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Cía&quot;</title>");
    const r = compilarCarpeta({ carpeta: raro.ficheros, catalogo: raro.app.catalogo, entrada: raro.app.entrada });
    expect(r.errores).toEqual([]);
    expect(raro.html).toContain('<html lang="en">');
  });

  it("lo que trae es lo que dice el manual de Len", () => {
    const manual = buildManualDeLaPlataforma({ OPENLEN_TERMINAL: "0" }, "len", e.app);
    for (const ruta of ["/src/App.jsx", "/src/screens", "/src/components", "/src/lib/supabase.js", "<HashRouter>"]) {
      expect(manual, ruta).toContain(ruta);
    }
  });
});
