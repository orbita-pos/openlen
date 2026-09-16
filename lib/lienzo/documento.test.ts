import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectData } from "@/lib/projects/types";
import { documentoDeVista, documentoMedible, vistaParaMedir, type ContextoDeVista } from "./documento";

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
    });
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
    ["la ruta del Agente", "app/api/agent/route.ts"],
    ["el arnés de evals", "lib/agent/evals/harness.ts"],
    ["el motor de la página", "lib/page-engine/prepare.ts"],
    ["el Chat (ai-design)", "app/api/templates/ai-design/route.ts"],
  ];

  it.each(MIDEN)("%s pasa por documentoMedible/vistaParaMedir", (_, ruta) => {
    const src = readFileSync(join(process.cwd(), ruta), "utf8");
    expect(
      /documentoMedible\(|vistaParaMedir\(/.test(src),
      `${ruta} mide un documento que el usuario no tiene delante`,
    ).toBe(true);
  });

  it("y la ruta del lienzo hornea con la función ESTRICTA, no con la blanda", () => {
    // Al servir la página el fallo blando sería servir un documento a medias.
    const src = readFileSync(join(process.cwd(), "app/api/lienzo/route.ts"), "utf8");
    expect(src).toContain("documentoDeVista(");
    expect(src).not.toContain("documentoMedible(");
  });
});
