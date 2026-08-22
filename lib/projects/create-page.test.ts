import { describe, expect, it } from "vitest";
import { createSitePage } from "./create-page";
import type { ProjectData } from "./types";

// Same fixture shape as site-pages.test.ts's buildPageShell suite — a home
// document with head/nav/footer so buildPageShell can produce a real shell.
const HOME_ES = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Mi Negocio</title></head>
<body>
<header><nav><a href="/">Inicio</a></nav></header>
<section id="hero"><h1>Bienvenido</h1></section>
<footer><small>© Mi Negocio</small></footer>
</body></html>`;

const baseData = (overrides?: Partial<ProjectData>): ProjectData => ({
  html: HOME_ES,
  ...overrides,
});

describe("createSitePage", () => {
  it("creates a page from the home shell, deriving the slug from the title when absent", () => {
    const out = createSitePage(baseData(), { title: "Sobre Nosotros" });
    if ("error" in out) throw new Error(`unexpected error: ${out.error} — ${out.message}`);
    expect(out.slug).toBe("sobre-nosotros");
    expect(out.title).toBe("Sobre Nosotros");
    expect(out.nextData.pages?.["sobre-nosotros"]?.title).toBe("Sobre Nosotros");
    // Born as the home shell: nav + footer survive, hero content doesn't.
    const pageHtml = out.nextData.pages!["sobre-nosotros"]!.html;
    expect(pageHtml).toContain('<a href="/">Inicio</a>');
    expect(pageHtml).toContain("© Mi Negocio");
    expect(pageHtml).not.toContain("Bienvenido");
    expect(pageHtml).toContain("Sobre Nosotros");
  });

  it("derives an accent-stripped slug from an accented Spanish title", () => {
    const out = createSitePage(baseData(), { title: "Catálogo" });
    if ("error" in out) throw new Error(`unexpected error: ${out.error} — ${out.message}`);
    expect(out.slug).toBe("catalogo");
    // The display title keeps its accent; only the URL slug is folded.
    expect(out.title).toBe("Catálogo");
  });

  it("clamps a long accented derived slug to <=40 chars and still succeeds", () => {
    const out = createSitePage(baseData(), {
      title: "Preguntas Frecuentes Sobre Envíos Y Devoluciones",
    });
    if ("error" in out) throw new Error(`unexpected error: ${out.error} — ${out.message}`);
    expect(out.slug.length).toBeLessThanOrEqual(40);
    expect(out.slug).toBe("preguntas-frecuentes-sobre-envios-y-devo");
  });

  it("a 40-char clamp landing exactly on a hyphen doesn't leave a dangling trailing hyphen", () => {
    // Constructed so slugFromTitle's raw 40-char slice ends EXACTLY on the
    // literal "-" between "mas" and "Devoluciones" — before the fix this
    // slice survives into validatePageSlug as a trailing "-", which SLUG_RE
    // rejects (must end in [a-z0-9]).
    const title = "Preguntas Frecuentes Sobre Envios Y Mas-Devoluciones Garantizadas Ya Disponible";
    const out = createSitePage(baseData(), { title });
    if ("error" in out) throw new Error(`unexpected error: ${out.error} — ${out.message}`);
    expect(out.slug.length).toBeLessThanOrEqual(40);
    expect(out.slug).not.toMatch(/[-\s]$/);
    expect(out.slug).toBe("preguntas-frecuentes-sobre-envios-y-mas");
  });

  it("rejects a reserved slug (cuenta) as invalid_slug", () => {
    const out = createSitePage(baseData(), { slug: "cuenta" });
    if (!("error" in out) || out.error !== "invalid_slug") {
      throw new Error(`expected invalid_slug, got ${JSON.stringify(out)}`);
    }
    expect(out.reason).toBe("reserved");
  });

  it("hits the 20-page limit before creating a 21st page", () => {
    const pages: ProjectData["pages"] = {};
    for (let i = 0; i < 20; i++) pages[`page-${i}`] = { html: "<html>x</html>" };
    const out = createSitePage(baseData({ pages }), { slug: "one-more" });
    if (!("error" in out) || out.error !== "limit_reached") {
      throw new Error(`expected limit_reached, got ${JSON.stringify(out)}`);
    }
    expect(out.limit).toBe(20);
  });

  it("rejects an existing slug as exists (checked before the page-count limit)", () => {
    const out = createSitePage(
      baseData({ pages: { menu: { html: "<html>menu</html>" } } }),
      { slug: "menu" },
    );
    if (!("error" in out) || out.error !== "exists") {
      throw new Error(`expected exists, got ${JSON.stringify(out)}`);
    }
    expect(out.slug).toBe("menu");
  });

  it("refuses to create a page when the project has no home html yet", () => {
    const out = createSitePage(baseData({ html: "" }), { slug: "menu" });
    if (!("error" in out)) throw new Error("expected an error");
    expect(out.error).toBe("no_home");
  });


  it("module branch ignores a co-supplied title (module's own title wins, matching today's route)", () => {
    const out = createSitePage(baseData(), { module: "collections", title: "Mi Catálogo" });
    if ("error" in out) throw new Error(`unexpected error: ${out.error}`);
    expect(out.title).toBe("Catálogo");
  });

  it("rejects a call with neither slug, title, nor module as invalid_input", () => {
    const out = createSitePage(baseData(), {});
    if (!("error" in out)) throw new Error("expected an error");
    expect(out.error).toBe("invalid_input");
  });

  it("places the module section between hero and a wrapper-expanded footer, not inside it", () => {
    const home = `<!doctype html><html lang="es">
<head><meta charset="utf-8"><title>Mi Negocio</title></head>
<body>
<header><nav><a href="/">Inicio</a></nav></header>
<section id="hero"><h1>Bienvenido</h1><p>mucho contenido intermedio aquí</p></section>
<div class="footer-band bg-black"><footer><small>© Wrap Co</small></footer></div>
</body></html>`;
    const out = createSitePage({ html: home }, { module: "collections" });
    if ("error" in out) throw new Error(`unexpected error: ${out.error} — ${out.message}`);
    const pageHtml = out.nextData.pages!["catalogo"]!.html;
    const band = pageHtml.indexOf("data-ol-collection-section");
    const wrapper = pageHtml.indexOf('class="footer-band bg-black"');
    expect(band).toBeGreaterThan(-1);
    expect(wrapper).toBeGreaterThan(-1);
    expect(band).toBeLessThan(wrapper);
  });

  it("places the module section above a ©-div footer (no semantic <footer>)", () => {
    const home = `<!doctype html><html lang="es">
<head><meta charset="utf-8"><title>Mi Negocio</title></head>
<body>
<header><nav><a href="/">Inicio</a></nav></header>
<section id="hero"><h1>Bienvenido</h1><p>contenido intermedio que da algo de largo al documento</p></section>
<div class="foot dark"><p>© Acme Studio</p><a href="/privacy">Privacidad</a></div>
</body></html>`;
    const out = createSitePage({ html: home }, { module: "collections" });
    if ("error" in out) throw new Error(`unexpected error: ${out.error} — ${out.message}`);
    const pageHtml = out.nextData.pages!["catalogo"]!.html;
    const band = pageHtml.indexOf("data-ol-collection-section");
    const foot = pageHtml.indexOf('class="foot dark"');
    expect(band).toBeGreaterThan(-1);
    expect(foot).toBeGreaterThan(-1);
    expect(band).toBeLessThan(foot);
  });

  it("rejects an out-of-range slug/title as invalid_input (agent path has no Zod)", () => {
    const tooLongSlug = createSitePage(baseData(), { slug: "a".repeat(61) });
    if (!("error" in tooLongSlug)) throw new Error("expected an error");
    expect(tooLongSlug.error).toBe("invalid_input");

    const tooLongTitle = createSitePage(baseData(), { title: "x".repeat(121) });
    if (!("error" in tooLongTitle)) throw new Error("expected an error");
    expect(tooLongTitle.error).toBe("invalid_input");
  });
});
