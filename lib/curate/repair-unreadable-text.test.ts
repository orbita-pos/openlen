import { describe, expect, it, vi } from "vitest";

import { repairUnreadableText } from "./repair-unreadable-text";

const page = (body: string, htmlAttrs = `style="--ol-bg:#f4eee2;--ol-fg:#26261f"`) =>
  `<!doctype html><html ${htmlAttrs}><head><style data-openlen-creative-section="ol-header-1">.site-head{color:#f6efe2}</style></head><body>${body}</body></html>`;

const HEADER = page(`<header class="site-head"><a class="brand" href="#">Casa del Lago</a></header>`);

/** La marca que el reparador acaba de poner, leída del documento que el render
 *  recibió — así la prueba no depende del orden interno del parser. */
function probeOf(html: string, className: string): number {
  const tag = new RegExp(`<[^>]*class="${className}"[^>]*>`).exec(html)?.[0] ?? "";
  const probe = /data-ol-probe="(\d+)"/.exec(tag)?.[1];
  return probe === undefined ? -1 : Number(probe);
}

describe("texto ilegible", () => {
  it("marca el documento antes de medirlo", async () => {
    const render = vi.fn(async (html: string) => {
      expect(html).toContain("data-ol-probe=");
      return { unreadableText: [] };
    });
    await repairUnreadableText(HEADER, render);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("corrige el elemento que se midió y no la regla que lo pintó", async () => {
    const result = await repairUnreadableText(HEADER, async (html) => ({
      unreadableText: [{ probe: probeOf(html, "brand"), background: "#f4eee2", contrast: 1.01 }],
    }));
    expect(result.repaired).toBe(1);
    expect(result.html).toContain(`<a class="brand" href="#" style="color:var(--ol-fg)">`);
    // La regla del modelo sigue intacta: puede estar pintando bien otros diez
    // elementos, y sólo el que se midió está mal.
    expect(result.html).toContain(`.site-head{color:#f6efe2}`);
  });

  it("sobre un fondo oscuro pone el polo claro", async () => {
    const result = await repairUnreadableText(HEADER, async (html) => ({
      unreadableText: [{ probe: probeOf(html, "brand"), background: "#1b2921", contrast: 1 }],
    }));
    expect(result.html).toContain("color:var(--ol-bg)");
  });

  it("sigue a la paleta cuando la página entera es oscura", async () => {
    const dark = page(`<header class="site-head"><a class="brand" href="#">x</a></header>`, `style="--ol-bg:#101410;--ol-fg:#f2efe6"`);
    const result = await repairUnreadableText(dark, async (html) => ({
      unreadableText: [{ probe: probeOf(html, "brand"), background: "#101410", contrast: 1.02 }],
    }));
    // Fondo oscuro quiere texto claro, y en una página oscura el polo claro es
    // --ol-fg. Nunca un literal: el tema puede cambiar después.
    expect(result.html).toContain("color:var(--ol-fg)");
  });

  it("conserva el estilo en línea que el elemento ya traía", async () => {
    const html = page(`<header class="site-head"><a class="brand" style="letter-spacing:.2em" href="#">x</a></header>`);
    const result = await repairUnreadableText(html, async (marked) => ({
      unreadableText: [{ probe: probeOf(marked, "brand"), background: "#f4eee2", contrast: 1.01 }],
    }));
    expect(result.html).toContain(`style="letter-spacing:.2em;color:var(--ol-fg)"`);
  });

  it("no deja marcas en el documento que se entrega", async () => {
    const result = await repairUnreadableText(HEADER, async (html) => ({
      unreadableText: [{ probe: probeOf(html, "brand"), background: "#f4eee2", contrast: 1.01 }],
    }));
    expect(result.html).not.toContain("data-ol-probe");
  });

  it("devuelve el documento intacto cuando no hay nada que corregir", async () => {
    const result = await repairUnreadableText(HEADER, async () => ({ unreadableText: [] }));
    expect(result).toEqual({ html: HEADER, repaired: 0 });
  });

  it.each([
    ["el render lanza", async () => { throw new Error("browser down"); }],
    ["el render no da nada", async () => null],
    ["el hallazgo no trae marca", async () => ({ unreadableText: [{ probe: -1, background: "#f4eee2", contrast: 1.01 }] })],
    ["la marca no existe en el documento", async () => ({ unreadableText: [{ probe: 9999, background: "#f4eee2", contrast: 1.01 }] })],
    ["el fondo medido no es un color", async () => ({ unreadableText: [{ probe: 0, background: "rojo" as string, contrast: 1.01 }] })],
  ])("no cuesta la página cuando %s", async (_name, render) => {
    const result = await repairUnreadableText(HEADER, render as never);
    expect(result).toEqual({ html: HEADER, repaired: 0 });
  });

  it("cae a un color literal cuando la página no declara sus polos", async () => {
    const html = `<!doctype html><html><body><p class="lead">x</p></body></html>`;
    const result = await repairUnreadableText(html, async (marked) => ({
      unreadableText: [{ probe: probeOf(marked, "lead"), background: "#ffffff", contrast: 1.02 }],
    }));
    expect(result.html).toContain("color:#111111");
  });
});
