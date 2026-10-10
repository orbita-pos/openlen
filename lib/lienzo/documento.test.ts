import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectData } from "@/lib/projects/types";
import {
  carpetaDeLaVista,
  carpetaServida,
  documentoDeVista,
  documentoMedible,
  pantallaDe,
  vistaConCarpeta,
  vistaParaMedir,
  type ContextoDeVista,
} from "./documento";

const DOC =
  '<!doctype html><html><head><title>t</title><base href="https://otro.example/"></head><body>' +
  '<a href="https://instagram.com/x" target="_blank">ig</a>' +
  '<form><input name="email"><button type="submit">Enviar</button></form>' +
  "</body></html>";

const ctx = (extra: Partial<ContextoDeVista> = {}): ContextoDeVista => ({
  projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09",
  title: "Mi negocio",
  sub: null,
  pagina: null,
  settings: undefined,
  logoUrl: null,
  ...extra,
});

describe("documentoDeVista: lo que se replica de la publicación", () => {
  it("el sello: quita <base> y pone noopener en target=_blank", () => {
    const out = documentoDeVista(DOC, ctx());
    expect(out).not.toMatch(/<base\b/i);
    expect(out).toMatch(/<a [^>]*rel="[^"]*noopener/);
  });

  it("el logo, cuando lo hay", () => {
    const out = documentoDeVista(DOC, ctx({ logoUrl: "https://uploads.example/logo.png" }));
    expect(out).toContain('rel="icon"');
    expect(out).toContain("https://uploads.example/logo.png");
  });

  it("el chat, cuando está activo", () => {
    const settings = { chat: { enabled: true } } as unknown as ProjectData["settings"];
    expect(documentoDeVista(DOC, ctx({ settings }))).toContain("data-ol-chat-widget");
  });
});

describe("documentoDeVista: lo que NO se replica", () => {
  it("🔴 el formulario no se cablea — cada envío sería un lead real", () => {
    expect(documentoDeVista(DOC, ctx())).not.toContain("/api/f/");
  });

  it("ni analítica ni tira de rastreo", () => {
    const out = documentoDeVista(DOC, ctx());
    expect(out).not.toContain("data-ol-cid-stamp");
    expect(out).not.toMatch(/\/c\/[0-9a-f-]{36}/);
  });
});

describe("vistaParaMedir: una sola forma de armar el contexto", () => {
  const FILA = {
    title: "Mi negocio",
    subdomain: "minegocio",
    data: { settings: { chat: { enabled: true } } as unknown as ProjectData["settings"] },
  };

  it("saca título, subdominio y ajustes de la fila del proyecto", () => {
    const v = vistaParaMedir("4f9c10cb-8781-48f1-b291-c5d146579f09", FILA, "menu");
    expect(v.projectId).toBe("4f9c10cb-8781-48f1-b291-c5d146579f09");
    expect(v.title).toBe("Mi negocio");
    expect(v.sub).toBe("minegocio");
    expect(v.pagina).toBe("menu");
    expect(v.settings).toBe(FILA.data.settings);
  });

  it("🔴 el logo va SIEMPRE a null al medir, y está declarado", () => {
    // `inject_logo` sólo toca el <head> (link rel=icon y, si falta, og:image),
    // así que no pinta un píxel de la captura. Traerlo costaría una columna más
    // en AgentDeps.loadProject y en cada uno de sus dobles. La diferencia se
    // declara en bake-surfaces.ts; lo que NO puede pasar es que un día alguien
    // le meta un logo aquí creyendo que lo mide.
    expect(vistaParaMedir("p1", FILA, null).logoUrl).toBeNull();
  });

  it("aguanta una fila a medias sin inventarse nada", () => {
    const v = vistaParaMedir("p1", {}, null);
    expect(v).toEqual({
      projectId: "p1",
      title: null,
      sub: null,
      pagina: null,
      settings: undefined,
      logoUrl: null,
      app: null,
    });
  });

  it("una app lleva su app (spec local 2026-10-07-apps)", () => {
    const app = { catalogo: "2026-10", entrada: "/src/main.jsx" };
    expect(vistaParaMedir("p1", { data: { app } }, null).app).toEqual(app);
  });
});

describe("documentoMedible: el horneado no puede tumbar una medición", () => {
  const VISTA: ContextoDeVista = {
    projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09",
    title: "t",
    sub: null,
    pagina: null,
    settings: undefined,
    logoUrl: null,
  };

  it("sin vista, el documento sale intacto — byte a byte como antes", () => {
    expect(documentoMedible(DOC, null)).toBe(DOC);
  });

  it("con vista, hornea", () => {
    const out = documentoMedible(DOC, VISTA);
    expect(out).not.toBe(DOC);
    expect(out).not.toMatch(/<base\b/i);
  });

  it("🔴 conserva TODOS los data-op-id: son la dirección de lo que se mide", () => {
    // Sin esto, medir el documento horneado dejaría a Len con «un bloque se
    // sale» y sin poder decir CUÁL — que es exactamente el defecto que el
    // gemelo etiquetado vino a cerrar el 2026-09-05.
    const etiquetado =
      '<!doctype html><html><head><title>t</title></head><body>' +
      '<section data-op-id="s1"><h1 data-op-id="h1">Hola</h1>' +
      '<p data-op-id="p1">Texto</p></section></body></html>';
    const out = documentoMedible(etiquetado, VISTA);
    for (const id of ["s1", "h1", "p1"]) {
      expect(out, `se perdió data-op-id="${id}" al hornear`).toContain(`data-op-id="${id}"`);
    }
  });

  it("si hornear revienta, se mide el documento crudo en vez de no medir", () => {
    const explota = () => {
      throw new Error("el binding nativo no cargó");
    };
    expect(documentoMedible(DOC, VISTA, explota)).toBe(DOC);
  });
});

/**
 * 🔴 PRUEBA 6 DE LA SPEC — TODO EL QUE MIDE, HORNEA.
 *
 * Se comprueba el FICHERO y no el tipo, por lo mismo que `aviso-medido.test.ts`:
 * TypeScript no puede exigir que un campo OPCIONAL se rellene, y `vista` es
 * opcional a propósito (sin ella todo sigue como antes). Un llamador que se
 * olvide compila, pasa los tipos, y mide una página que el usuario no tiene
 * delante — en silencio, que es como se cuelan estas cosas aquí.
 */
describe("las superficies que miden hornean el documento de vista", () => {
  const MIDEN: ReadonlyArray<readonly [string, string]> = [
    ["los ojos de Len", "lib/agent/verify.ts"],
    // ⚰️ «la ruta del Agente» (`app/api/agent/route.ts`) medía por su cuenta
    // al cerrar el turno y tras cada edición (`verifyTurn`, `medirParaElModelo`).
    // Las dos se retiraron el 2026-10-06 (plans/crear-es-len, tarea 10): ahora
    // mide sólo Len, a mano, y quien arma su vista es `tools.ts`.
    ["las herramientas de Len (view_page, use_page)", "lib/agent/tools.ts"],
    ["el motor de la página", "lib/page-engine/prepare.ts"],
    ["el Chat (ai-design)", "app/api/templates/ai-design/route.ts"],
  ];

  // ⚠️ ESTA COMPROBACIÓN ES UN SUELO, Y SE SABE POR QUÉ. Mira el FICHERO, no la
  // llamada: un fichero con DOS caminos que miden pasa con que uno solo hornee.
  // Pasó — `lib/agent/verify.ts` la cumplía desde el 2026-09-15 porque
  // `runVerify` horneaba, mientras `observarPagina`, en el mismo fichero, medía
  // el documento pelado; o sea que `view_page`, la herramienta que el modelo
  // llama a mano hasta cuatro veces por turno, seguía mirando una página que el
  // usuario no tiene delante. En verde en las 195 pruebas del plan y en las
  // 5194 de la suite.
  //
  // Quien fija cada CAMINO son las pruebas de comportamiento (`verify.test.ts`:
  // «lo que se MIDE va horneado» para los ojos y «view_page mide el documento
  // HORNEADO» para la mirada, las dos con su contra-prueba sin `vista`). Esto se
  // queda porque sigue cazando lo que aquéllas no pueden: una superficie que
  // deja de hornear ENTERA, o una nueva que nace sin hacerlo.
  it.each(MIDEN)("%s pasa por documentoMedible/vistaParaMedir", (_, ruta) => {
    const src = readFileSync(join(process.cwd(), ruta), "utf8");
    expect(
      /documentoMedible\(|vistaParaMedir\(/.test(src),
      `${ruta} mide un documento que el usuario no tiene delante`,
    ).toBe(true);
  });

  // La SEXTA superficie, que no estaba en la lista y medía sin hornear: el
  // puente entre la herramienta y `observarPagina`. Se comprueba aquí porque es
  // el único punto donde se decide si la mirada recibe contexto o no — el
  // comportamiento de `observarPagina` con y sin él lo fijan sus pruebas.
  it("🔴 view_page le pasa la vista a observarPagina", () => {
    const src = readFileSync(join(process.cwd(), "lib/agent/tools.ts"), "utf8");
    expect(
      /observarPagina\(\{[\s\S]{0,600}?vista:/.test(src),
      "toolMirarPagina llama a observarPagina sin vista: mide el documento pelado",
    ).toBe(true);
  });

  // ⚰️ La lista tenía una sexta entrada, «el arnés de evals»
  // (`lib/agent/evals/harness.ts`): la batería de Len 1.x, retirada con su arnés
  // en `a3d5b76c`. La vara de hoy, Len-Bench, NO mide un borrador —y por eso no
  // hornea nada—: publica por el camino real y califica la release servida como
  // la sirve Caddy, que es lo que el visitante tiene delante, ya horneado por
  // `publishToDir`. Lo que hay que sujetar ahí es eso.
  it("Len-Bench no mide un borrador: publica de verdad y califica lo que se sirve", () => {
    const src = readFileSync(join(process.cwd(), "lib/len-bench/conductor.ts"), "utf8");
    expect(src, "Len-Bench calificaría algo que no se publicó").toMatch(/\bpublishProject\(/);
    expect(src, "Len-Bench calificaría algo que no se sirve como en producción").toMatch(/\bservirPublicada\(/);
  });

  // BRAZO DE CONTROL: si vuelve un arnés que mida BORRADORES, tiene que volver
  // a la lista de arriba. Esta prueba se pone roja para recordarlo.
  it("el arnés de borradores de Len 1.x sigue sin existir", () => {
    expect(existsSync(join(process.cwd(), "lib/agent/evals/harness.ts"))).toBe(false);
  });

  it("y la ruta del lienzo hornea con la función ESTRICTA, no con la blanda", () => {
    // Al servir la página el fallo blando sería servir un documento a medias.
    const src = readFileSync(join(process.cwd(), "app/api/lienzo/route.ts"), "utf8");
    expect(src).toContain("documentoDeVista(");
    expect(src).not.toContain("documentoMedible(");
  });
});

// ── LAS APPS WEB (spec local 2026-10-07-apps) ───────────────────────────────
describe("una app en la vista", () => {
  const APP = { catalogo: "2026-10", entrada: "/src/main.jsx" };
  const CASCARON =
    '<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body><div id="root"></div>' +
    '<script type="module" src="/src/main.jsx"></script></body></html>';

  it("🔴 documentoDeVista: una app ya NO lleva import map (plan 02): su entrada es el paquete, y la carga tal cual", () => {
    const html = documentoDeVista(CASCARON, ctx({ app: APP }));
    expect(html).not.toContain("importmap");
    expect(html).toContain('src="/src/main.jsx"');
  });

  it("documentoMedible: aunque el horneado falle, una app se mide cruda (su entrada es el paquete)", () => {
    const html = documentoMedible(CASCARON, ctx({ app: APP }), () => {
      throw new Error("binding caído");
    });
    expect(html).toBe(CASCARON);
  });

  it("carpetaDeLaVista: la entrada es el PAQUETE (plan 02), los demás fuentes compilados y el catálogo, en el modo de desarrollo", async () => {
    const carpeta = await carpetaDeLaVista(
      ctx({
        app: APP,
        files: {
          "/src/main.jsx": 'import App from "./App";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.body).render(<App />);',
          "/src/App.jsx": "export default () => <h1>Hola</h1>;",
          "/data/menu.json": "[]",
        },
      }),
    );
    // La entrada lleva App dentro y React también: ni un import por su nombre.
    expect(carpeta?.files["/src/main.jsx"]).toContain("Hola");
    expect(carpeta?.files["/src/main.jsx"]).not.toMatch(/\bfrom\s*["']react/);
    expect(carpeta?.sourceMaps?.["/src/main.jsx"]).toBeTruthy();
    // Como la publicada: App va DENTRO del paquete, y el catálogo también.
    expect(carpeta?.files["/src/App.jsx"]).toBeUndefined();
    expect(carpeta?.files["/data/menu.json"]).toBe("[]");
    expect(Object.keys(carpeta?.files ?? {}).some((r) => r.startsWith("/openlen/vendor/"))).toBe(false);
  }, 60_000);

  it("carpetaDeLaVista: una app sin ficheros trae igualmente su entrada (que dice qué falta); una página sin ficheros, nada", async () => {
    expect((await carpetaDeLaVista(ctx({ app: APP })))?.files["/src/main.jsx"]).toMatch(/^throw new SyntaxError\(/);
    expect(await carpetaDeLaVista(ctx())).toBeUndefined();
  });

  it("carpetaDeLaVista: una app pide esperar a la red y lleva la pantalla; una página, nada de eso", async () => {
    expect(await carpetaDeLaVista(ctx({ app: APP, pantalla: "#/ventas" }))).toMatchObject({ hash: "#/ventas", esperarALaRed: true });
    expect(await carpetaDeLaVista(ctx({ app: APP }))).not.toHaveProperty("hash");
    const pagina = await carpetaDeLaVista(ctx({ files: { "/js/a.js": "1" }, pantalla: "#/ventas" }));
    expect(pagina).not.toHaveProperty("hash");
    expect(pagina).not.toHaveProperty("esperarALaRed");
  });

  it("pantallaDe: «ventas», «/ventas» y «#/ventas» son la misma; vacía o el principio, ninguna", () => {
    for (const v of ["ventas", "/ventas", "#/ventas", " #/ventas "]) expect(pantallaDe(v), v).toBe("#/ventas");
    expect(pantallaDe("#/ventas/12?x=1")).toBe("#/ventas/12?x=1");
    for (const v of ["", "/", "#/", "con espacio", 3, undefined]) expect(pantallaDe(v), String(v)).toBeNull();
  });

  it("vistaConCarpeta: una app trae su import.meta.env; una página no lo pide", async () => {
    let pedido = 0;
    const deps = {
      projectFiles: async () => ({ "/src/main.jsx": "" }),
      entornoDeLaApp: async () => {
        pedido++;
        return { VITE_SUPABASE_URL: "https://x.openlen.app" };
      },
    };
    const conApp = await vistaConCarpeta(ctx({ app: APP }), deps, "p1");
    expect(conApp.entorno).toEqual({ VITE_SUPABASE_URL: "https://x.openlen.app" });
    await vistaConCarpeta(ctx(), deps, "p1");
    expect(pedido).toBe(1);
  });
  it("🔴 /.env (spec local 2026-10-10): llega a los ojos para compilar, pero no se sirve", async () => {
    const deps = { projectFiles: async () => ({ "/js/x.ts": "export const a = import.meta.env.VITE_A;", "/.env": "VITE_A=uno", "/tests/a.test.ts": "" }) };
    const vista = await vistaConCarpeta(ctx(), deps, "p1");
    expect(Object.keys(vista.files ?? {}).sort()).toEqual(["/.env", "/js/x.ts"]);
    const servida = await carpetaServida(vista.files!, null);
    expect(Object.keys(servida.files)).toEqual(["/js/x.ts"]);
    expect(servida.files["/js/x.ts"]).toContain('"uno"');
  });
});
