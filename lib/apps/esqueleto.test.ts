// @vitest-environment node
// Con lo que nace una app (H10): tiene que compilar y arrancar tal cual, y lo
// que trae es lo que el manual de Len dice que hay.
import { describe, expect, it } from "vitest";
import { compilarCarpeta, textoDeDiagnostico } from "./compilador";
import { CATALOGO_ACTUAL } from "./dependencias";
import { ENTRADA, esqueletoDeApp } from "./esqueleto";
import { problemasDelCascaron } from "@/lib/agent/compila-la-app";
import { buildManualDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import { pendingInstall } from "@/lib/apps/npm/install";
import { PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";

describe("el esqueleto de una app", () => {
  const e = esqueletoDeApp({ titulo: "Caja del Café", idioma: "es" });

  it("🔴 compila entero y el cascarón la arranca", () => {
    const r = compilarCarpeta({ carpeta: e.ficheros, catalogo: e.app.catalogo });
    expect(r.errores.map(textoDeDiagnostico)).toEqual([]);
    expect(problemasDelCascaron(e.app, e.html, e.ficheros)).toEqual([]);
  });

  // 🔴 Jesús, 10/10: las apps nacían en .jsx y TypeScript no revisaba nada.
  it("🔴 nace en TypeScript: main.tsx, App.tsx, la primera pantalla y el cliente del backend", () => {
    expect(ENTRADA).toBe("/src/main.tsx");
    // Y su /package.json, como un proyecto de Vite (npm abierto, 2026-10-13).
    expect(Object.keys(e.ficheros).sort()).toEqual(["/package.json", "/src/App.tsx", "/src/lib/supabase.ts", "/src/main.tsx", "/src/screens/Inicio.tsx"]);
    expect(e.html).toContain(`<script type="module" src="/src/main.tsx"></script>`);
  });

  it("es una app del catálogo actual, que empieza en su entrada", () => {
    expect(e.app).toEqual({ catalogo: CATALOGO_ACTUAL, entrada: ENTRADA });
    expect(e.html).toContain('<html lang="es">');
    expect(e.html).toContain("<title>Caja del Café</title>");
    expect(e.html).toContain('<script src="https://cdn.tailwindcss.com"></script>');
  });

  it("el cliente del backend lee import.meta.env: ninguna clave escrita", () => {
    expect(e.ficheros["/src/lib/supabase.ts"]).toContain("import.meta.env.VITE_SUPABASE_URL");
    expect(e.ficheros["/src/lib/supabase.ts"]).not.toMatch(/sb_|https:\/\//);
  });

  it("un título con comillas o etiquetas no rompe ni el cascarón ni el JSX", () => {
    const raro = esqueletoDeApp({ titulo: '<script>alert("x")</script> & "Cía"' });
    expect(raro.html).toContain("<title>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Cía&quot;</title>");
    const r = compilarCarpeta({ carpeta: raro.ficheros, catalogo: raro.app.catalogo });
    expect(r.errores).toEqual([]);
    expect(raro.html).toContain('<html lang="en">');
  });

  it("lo que trae es lo que dice el manual de Len", () => {
    const manual = buildManualDeLaPlataforma({ OPENLEN_TERMINAL: "0" }, "len", e.app);
    for (const ruta of ["/src/App.tsx", "/src/screens", "/src/components", "/src/lib/supabase.ts", "<HashRouter>"]) {
      expect(manual, ruta).toContain(ruta);
    }
  });
});

describe("the app skeleton and package.json", () => {
  it("is born with /package.json listing what it imports, at the catalog's versions, and nothing to install", () => {
    const e = esqueletoDeApp({ titulo: "Demo" });
    const files = e.ficheros as Record<string, string>;
    expect(JSON.parse(files[PACKAGE_JSON_PATH]!).dependencies).toEqual({
      "@supabase/supabase-js": "^2.117.2",
      react: "^19.2.6",
      "react-dom": "^19.2.6",
      "react-router-dom": "^7.18.4",
    });
    expect(pendingInstall(files, { catalogo: "2026-11", entrada: "/src/main.tsx" })).toEqual({ add: [], remove: [] });
  });
});
