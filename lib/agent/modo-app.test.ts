// @vitest-environment node
// LEN EN UNA APP WEB (F3 de la spec local 2026-10-07-apps): lo que lee cuando el
// proyecto es una app, y que lo de una página no se mueve por ello.
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "./catalog";
import { buildManualDeLaPlataforma, documentosDeLaPlataforma, textoDeLaPlataforma } from "./manual-de-la-plataforma";
import { GUIA_DE_LA_APP, HERRAMIENTAS_QUE_CAMBIAN_EN_UNA_APP, promptDeLaApp } from "./modo-app";
import { RUTA_GUIA, RUTA_LIBRERIAS, RUTA_MANUAL } from "./ficheros/manual";
import { summarizeProjectState } from "./tools";
import { CATALOGO_ACTUAL, catalogo } from "@/lib/apps/dependencias";

const APP = { catalogo: CATALOGO_ACTUAL, entrada: "/src/main.jsx" };
const ENV = { OPENLEN_TERMINAL: "0" };

describe("el prompt de sistema de una app", () => {
  const pagina = buildAgentSystemPrompt(ENV);
  const app = buildAgentSystemPrompt(ENV, "len", APP);

  it("sin app, el de siempre: byte a byte", () => {
    expect(buildAgentSystemPrompt(ENV, "len", null)).toBe(pagina);
  });

  it("dice que es una app, y deja de decir lo que en una app es falso", () => {
    expect(app).toMatch(/THIS project is a web app: React code in \/src/);
    expect(app).toMatch(/THE APP IS FILES:/);
    expect(app).not.toMatch(/each project is a site made of HTML files/);
    expect(app).not.toMatch(/THE SITE IS FILES/);
    expect(app).not.toMatch(/A new page is a Write to \/<slug>\/index\.html/);
    expect(app).not.toMatch(/What a page can do is not limited/);
    expect(app).toMatch(/Screens are hash routes \(\/#\/sales\)/);
    expect(app).toMatch(/Never a \/<slug>\/index\.html/);
    expect(app).toMatch(/<script type="module" src="\/src\/main\.jsx">/);
    expect(app).toMatch(/supabase\.rpc/);
  });

  it("🔴 la conducta es la MISMA: TONO, la memoria y lo que lees es dato, enteros", () => {
    const seccion = (texto: string, desde: string, hasta: string) => texto.slice(texto.indexOf(desde), texto.indexOf(hasta, texto.indexOf(desde)));
    expect(seccion(app, "TONE:", "HOW TO WORK:")).toBe(seccion(pagina, "TONE:", "HOW TO WORK:"));
    expect(app.slice(app.indexOf("MEMORY IS TWO FILES"))).toBe(pagina.slice(pagina.indexOf("MEMORY IS TWO FILES")));
    // Y las viñetas de CÓMO TRABAJAR que no hablan de la página.
    for (const v of ["- You don't ask permission for what you were already asked to do", "- A single response can carry several tool calls."]) {
      expect(app).toContain(v);
    }
  });

  it("sus datos no se inventan: se piden o se meten desde la app", () => {
    expect(app).toMatch(/never invented or guessed/);
    expect(app).toMatch(/obviously examples/);
  });

  it("si el prompt de la página cambia de redacción, LANZA en vez de mandar uno a medias", () => {
    expect(() => promptDeLaApp("You are Len.", APP)).toThrow(/la marca/);
  });
});

describe("el manual de una app con el catálogo 2026-11 (apps 2026-11, tarea 6)", () => {
  const nuevo = buildManualDeLaPlataforma(ENV, "len", { catalogo: "2026-11", entrada: "/src/main.jsx" });
  const viejo = buildManualDeLaPlataforma(ENV, "len", { catalogo: "2026-10", entrada: "/src/main.jsx" });

  it("nombra radix-ui y shadcn, y no lista los @radix-ui sueltos", () => {
    expect(nuevo).toContain("· radix-ui — ");
    // Cómo se usa shadcn aquí, no sólo su nombre (que ya sale en la línea de radix-ui).
    expect(nuevo).toMatch(/shadcn\/ui works as usual[^\n]*\/src\/components\/ui[^\n]*cn\(\)/);
    expect(nuevo).not.toMatch(/· @radix-ui\/react-dialog — /);
  });

  it("dice que una hoja puede usar @layer y @apply, y que el tailwind.config es datos, sin require ni plugins", () => {
    expect(nuevo).toMatch(/@layer and @apply/);
    expect(nuevo).toMatch(/no require\(\) and no plugins/);
    expect(nuevo).toMatch(/tailwindcss-animate is not available/);
  });

  it("🔴 dice que es Tailwind 3: el CSS de shadcn v4 (@import \"tailwindcss\", @theme) no funciona aquí", () => {
    expect(nuevo).toMatch(/Tailwind CSS 3/);
    expect(nuevo).toMatch(/@theme/);
    expect(nuevo).toMatch(/@import "tailwindcss"/);
  });

  it("con 2026-10 no promete shadcn (no tiene sus paquetes)", () => {
    expect(viejo).not.toMatch(/shadcn\/ui works as usual/);
    expect(viejo).not.toContain("· radix-ui — ");
  });
});

describe("el manual de una app (/AGENTS.md)", () => {
  const manual = buildManualDeLaPlataforma(ENV, "len", APP);

  it("dice cómo se escriben y se corren las pruebas (plan 04)", () => {
    expect(manual).toMatch(/TESTS: vitest and Testing Library/);
    expect(manual).toMatch(/npm test/);
    expect(manual).toMatch(/vi\.mock/);
    expect(manual).not.toMatch(/there is no npm test yet/);
  });

  it("dice que tipos y lint llegan solos, y cómo correrlos (plan 03)", () => {
    expect(manual).toMatch(/TYPES AND LINT/);
    expect(manual).toMatch(/npx tsc --noEmit/);
    expect(manual).toMatch(/npm run lint/);
    expect(manual).toMatch(/don't stop the app or the publish/);
  });

  it("dice que la app va empaquetada y qué hace npm run build (plan 02)", () => {
    expect(manual).toMatch(/BUILD: the app is served as ONE bundle/);
    expect(manual).toMatch(/npm run build/);
  });

  it("nombra cada paquete de SU catálogo, y nada de las librerías de las páginas", () => {
    for (const d of catalogo(APP.catalogo)!.dependencias) {
      // Los `@radix-ui/react-*` sueltos no: el manual nombra `radix-ui`.
      if (d.hiddenFromManual) expect(manual).not.toContain(`· ${d.especificador} — `);
      else expect(manual).toContain(`· ${d.especificador} — `);
    }
    expect(manual).not.toMatch(/libs\.openlen\.com|cdn\.jsdelivr\.net\/npm\/@supabase/);
    expect(manual).not.toContain(RUTA_LIBRERIAS);
  });

  it("🔴 no dice lo que en una app es falso: «un solo <!doctype html>», «sin JSX», «los formularios llegan a tu correo»", () => {
    expect(manual).not.toMatch(/No JSX/);
    expect(manual).not.toMatch(/ONE complete, self-contained/);
    expect(manual).not.toMatch(/^- Forms work:/m);
    expect(manual).toMatch(/An app's forms don't reach the user's email/);
  });

  it("el backend es la sección de la página entera, con supabase-js importado de /src/lib/supabase.js", () => {
    const deLaPagina = buildManualDeLaPlataforma(ENV);
    const backend = (t: string) => t.slice(t.indexOf("THE BACKEND (Supabase):"), t.indexOf("\n\n", t.indexOf("- To change what was already pushed")));
    expect(backend(manual)).toContain('import { supabase } from "@/lib/supabase"');
    expect(backend(manual)).not.toContain("<script src=");
    // El resto de la sección, igual palabra por palabra.
    const sinLaLinea = (t: string) => backend(t).split("\n").filter((l) => !/^- In the (page|app)/.test(l)).join("\n");
    expect(sinLaLinea(manual)).toBe(sinLaLinea(deLaPagina));
  });

  it("las clases de Tailwind enteras, las pantallas por hash y los errores con su línea", () => {
    expect(manual).toMatch(/written WHOLE/);
    expect(manual).toMatch(/The address is \/#\/sales/);
    expect(manual).toMatch(/comes back in <new-diagnostics> with its file and line/);
  });

  it("Read de /AGENTS.md y de la guía devuelve los de la app; la de librerías no existe en una app", () => {
    expect(textoDeLaPlataforma(RUTA_MANUAL, "len", APP)).toBe(buildManualDeLaPlataforma(process.env, "len", APP));
    expect(textoDeLaPlataforma(RUTA_GUIA, "len", APP)).toBe(GUIA_DE_LA_APP);
    expect(textoDeLaPlataforma(RUTA_LIBRERIAS, "len", APP)).toBeNull();
    expect(Object.keys(documentosDeLaPlataforma(APP))).toEqual([RUTA_GUIA]);
    // Y en una página, los de siempre.
    expect(textoDeLaPlataforma(RUTA_LIBRERIAS)).not.toBeNull();
  });
});

describe("las herramientas en una app", () => {
  const pagina = buildFunctionDeclarations(ENV);
  const app = buildFunctionDeclarations(ENV, {}, "len", APP);
  const de = (lista: Record<string, unknown>[], nombre: string) => lista.find((d) => d.name === nombre) as {
    description: string;
    parameters: { properties: Record<string, unknown> };
  };

  it("las MISMAS herramientas, en el mismo orden, menos convert_to_app (una app ya lo es)", () => {
    expect(app.map((d) => d.name)).toEqual(pagina.map((d) => d.name).filter((n) => n !== "convert_to_app"));
    expect(pagina.map((d) => d.name)).toContain("convert_to_app");
  });

  it("mirar y usar abren una PANTALLA (#/ruta), no una página", () => {
    for (const n of ["view_page", "use_page"]) {
      expect(de(app, n).parameters.properties).toHaveProperty("screen");
      expect(de(app, n).parameters.properties).not.toHaveProperty("file_path");
      expect(de(pagina, n).parameters.properties).toHaveProperty("file_path");
    }
  });

  it("deshacer es el turno anterior entero, sin fichero que elegir", () => {
    expect(de(app, "undo_last_change").description).toMatch(/Undoes your PREVIOUS turn whole/);
    expect(de(app, "undo_last_change").parameters.properties).toEqual({});
  });

  it("publish no acepta idiomas (languages): una app no se traduce sola", () => {
    expect(de(app, "publish").parameters.properties).not.toHaveProperty("languages");
    expect(de(app, "publish").description).toMatch(/without translations/);
    expect(de(pagina, "publish").parameters.properties).toHaveProperty("languages");
  });

  it("sin app, las de siempre", () => {
    expect(buildFunctionDeclarations(ENV, {}, "len", null)).toEqual(pagina);
  });
});

describe("el estado del proyecto en una app", () => {
  const fila = {
    title: "Caja",
    subdomain: null,
    publishedAt: null,
    data: { html: "<div id=root></div>", app: APP },
    ficherosDeLaCarpeta: ["/src/main.jsx", "/src/App.jsx", "/memoria/proyecto.md", "/supabase/migrations/1_a.sql"],
  };

  it("lista el código de la app y dice que es una app; sin «página abierta»", () => {
    const estado = summarizeProjectState(fila);
    expect(estado.ficheros).toEqual(["/index.html", "/src/App.jsx", "/src/main.jsx", "/supabase/migrations/1_a.sql"]);
    expect(estado.app).toEqual({ entrada: "/src/main.jsx", catalogo: CATALOGO_ACTUAL });
    expect(estado).not.toHaveProperty("abierta_en_el_editor");
  });

  it("en una página, el estado de siempre (la carpeta no entra)", () => {
    const estado = summarizeProjectState({ ...fila, data: { html: "<p>hola</p>" } });
    expect(estado.ficheros).toEqual(["/index.html"]);
    expect(estado.abierta_en_el_editor).toBe("/index.html");
    expect(estado).not.toHaveProperty("app");
  });
});

// 🔴 LOS NOMBRES QUE USA. El modo app reconoce herramientas POR SU NOMBRE y las
// nombra en su prompt y su manual. Si el catálogo las renombra (hay una rama
// que las pasa al inglés) y esto no, nada falla: la app recibe la herramienta
// de una página y Len lee nombres que no existen. Estas dos pruebas lo cazan.
describe("los nombres que usa el modo app", () => {
  const app = buildFunctionDeclarations(ENV, {}, "len", APP);
  const declaradas = new Set(app.map((d) => String(d.name)));

  it("cada herramienta que cambia en una app existe en el catálogo", () => {
    for (const n of HERRAMIENTAS_QUE_CAMBIAN_EN_UNA_APP) expect(declaradas.has(n), n).toBe(true);
  });

  it("todo lo que parece el nombre de una herramienta en su prompt, su manual y su guía existe", () => {
    const texto = [
      buildAgentSystemPrompt(ENV, "len", APP),
      buildManualDeLaPlataforma(ENV, "len", APP),
      ...Object.values(documentosDeLaPlataforma(APP)),
      ...app.map((d) => String(d.description ?? "")),
    ].join("\n");
    // Lo que tiene forma de nombre y NO es una herramienta: un parámetro, un
    // valor o un identificador de Postgres. Si una herramienta se renombra, su
    // nombre viejo cae aquí y la prueba lo dice.
    const NO_SON_HERRAMIENTAS = new Set(["blocked_reason", "sign_in_as", "postgres_changes", "supabase_realtime", "by_date", "output_mode"]);
    const sueltos = [...new Set([...texto.matchAll(/\b[a-z]+(?:_[a-z0-9]+)+\b/g)].map((m) => m[0]))].filter(
      (t) => !declaradas.has(t) && !NO_SON_HERRAMIENTAS.has(t),
    );
    expect(sueltos).toEqual([]);
  });
});
