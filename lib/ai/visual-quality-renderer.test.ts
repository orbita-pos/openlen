import { describe, expect, it, vi } from "vitest";

import { createVisualQualityRendererPool, renderVisualCandidateContactSheet, renderVisualQualityViewports } from "./visual-quality-renderer";

const HTML = "<!doctype html><html><body>hello</body></html>";

describe("renderVisualQualityViewports", () => {
  it("renders verified fragments once as a labeled bounded JPEG contact sheet through the existing pool", async () => {
    const jpeg = { mimeType: "image/jpeg", dataBase64: Buffer.from("jpeg").toString("base64") } as const;
    let renderedHtml = "";
    const pool = {
      render: vi.fn(async (html: string) => {
        renderedHtml = html;
        return { desktop: jpeg, mobile: jpeg };
      }),
      close: vi.fn(async () => undefined),
    };
    const result = await renderVisualCandidateContactSheet([
      { candidateId: "hero-safe", ordinal: 0, role: "hero", html: '<section data-sec="hero-safe">Hero</section>' },
      { candidateId: "features-safe", ordinal: 1, role: "features", html: '<section data-sec="features-safe">Features</section>' },
    ], pool);
    expect(result).toEqual(jpeg);
    expect(pool.render).toHaveBeenCalledTimes(1);
    expect(renderedHtml).toContain("0 · hero · hero-safe");
    expect(renderedHtml).toContain("1 · features · features-safe");
    expect(renderedHtml).toContain("data-sec=&quot;hero-safe&quot;");
  });

  it("refuses more than twelve contact-sheet fragments before using a browser worker", async () => {
    const pool = { render: vi.fn(), close: vi.fn() };
    const fragments = Array.from({ length: 13 }, (_, index) => ({
      candidateId: `hero-${index}`,
      ordinal: index,
      role: "hero",
      html: `<section data-sec="hero-${index}">Hero</section>`,
    }));
    await expect(renderVisualCandidateContactSheet(fragments, pool)).resolves.toBeNull();
    expect(pool.render).not.toHaveBeenCalled();
  });

  it("isolates active fragment content from labels, top navigation, the document, and the next pooled render", async () => {
    const documents: string[] = [];
    const jpeg = { mimeType: "image/jpeg", dataBase64: Buffer.from("jpeg").toString("base64") } as const;
    const pool = {
      render: vi.fn(async (html: string) => { documents.push(html); return { desktop: jpeg, mobile: jpeg }; }),
      close: vi.fn(async () => undefined),
    };
    const malicious = `<style>body,figcaption{display:none!important}</style><script>top.location='https://private.invalid';document.write('replaced')</script><img onerror="top.location='https://private.invalid'" src=x><svg onload="document.write('svg')"></svg><section data-sec="hero-hostile">first-run-sentinel</section>`;
    await renderVisualCandidateContactSheet([{ candidateId: "hero-hostile", ordinal: 0, role: "hero", html: malicious }], pool);
    await renderVisualCandidateContactSheet([{ candidateId: "hero-safe", ordinal: 0, role: "hero", html: '<section data-sec="hero-safe">second</section>' }], pool);

    expect(documents[0]).toContain('<iframe sandbox=""');
    expect(documents[0]).not.toMatch(/allow-scripts|allow-top-navigation|<script>|<style>body,figcaption/);
    expect(documents[0]).toContain("&lt;script&gt;top.location=");
    expect(documents[0].indexOf("<figcaption")).toBeLessThan(documents[0].indexOf("<iframe"));
    expect(documents[1]).not.toContain("first-run-sentinel");
    expect(documents[1]).toContain("hero-safe");
  });

  it("injects a deterministic reset and fails closed when consecutive mobile geometry samples disagree", async () => {
    const pageHtml: string[] = [];
    const noOverflow = { rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390 };
    const shiftedGeometry = { rootScrollWidth: 391, bodyScrollWidth: 390, clientWidth: 390 };
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async (html: string) => { pageHtml.push(html); }),
      // Siete evaluaciones por render, y este doble las sirve en orden: dos
      // esperas de layout (escritorio y móvil), las DOS lecturas de geometría
      // —que es lo que esta prueba mide—, la recogida de candidatos del
      // sondeo de contraste, su restauración, y el programa de pulsar.
      // Devolver `undefined` en la recogida deja cero candidatos, así que no
      // se toma captura de sondeo: aquí no estorba.
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(noOverflow)
        .mockResolvedValueOnce(shiftedGeometry)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(noOverflow)
        .mockResolvedValueOnce(shiftedGeometry)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };
    const internals = {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    };

    const first = await renderVisualQualityViewports(HTML, internals);
    const second = await renderVisualQualityViewports(HTML, internals);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.mobileOverflow).toBe(true);
    expect(first?.mobileOverflow).toBe(second?.mobileOverflow);
    expect(pageHtml).toHaveLength(2);
    expect(pageHtml[0]).toContain("animation:none!important");
    expect(pageHtml[0]).toContain("transition:none!important");
  });

  it("ignores diagnostic-only sample changes when deciding mobile overflow", async () => {
    const firstSample = {
      rootScrollWidth: 390,
      bodyScrollWidth: 390,
      clientWidth: 390,
      h1FontPx: 9,
      heroBodyFontPx: 4,
      componentCount: 4,
      roundedComponentCount: 0,
    };
    const secondSample = {
      rootScrollWidth: 390,
      bodyScrollWidth: 390,
      clientWidth: 390,
      h1FontPx: 48,
      heroBodyFontPx: 17,
      componentCount: 4,
      roundedComponentCount: 4,
    };
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(firstSample)
        .mockResolvedValueOnce(secondSample),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({
      mobileOverflow: false,
      weakTypographyHierarchy: true,
      squareComponentTreatment: true,
    });
  });

  it("reuses two browser workers and never renders more than two pages concurrently", async () => {
    let active = 0;
    let maximum = 0;
    const release: Array<() => void> = [];
    const close = vi.fn(async () => undefined);
    const launchBrowser = vi.fn(async () => ({
      newPage: async () => ({
        setViewport: async () => undefined,
        setContent: async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await new Promise<void>((resolve) => release.push(resolve));
          active -= 1;
        },
        evaluate: async () => ({}),
        screenshot: async () => Buffer.from("jpeg"),
      }),
      close,
    }));
    const pool = await createVisualQualityRendererPool(2, {
      launchBrowser,
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    const renders = Array.from({ length: 6 }, (_, index) => pool.render(`${HTML}${index}`));
    for (let wave = 0; wave < 3; wave += 1) {
      await vi.waitFor(() => expect(release).toHaveLength(2));
      release.splice(0).forEach((resolve) => resolve());
    }
    await expect(Promise.all(renders)).resolves.toHaveLength(6);
    await pool.close();

    expect(maximum).toBe(2);
    expect(launchBrowser).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("captures desktop then mobile with the exact calibrated viewports", async () => {
    const calls: Array<{ width: number; height: number }> = [];
    const result = await renderVisualQualityViewports(HTML, {
      capture: async (_html, viewport) => {
        calls.push(viewport);
        return {
          mimeType: "image/jpeg",
          dataBase64: Buffer.from(String(viewport.width)).toString("base64"),
        };
      },
    });

    expect(calls).toEqual([{ width: 1280, height: 720 }, { width: 390, height: 844 }]);
    expect(result).toMatchObject({
      desktop: { mimeType: "image/jpeg" },
      mobile: { mimeType: "image/jpeg" },
    });
  });

  it("returns null when either capture is missing or exceeds one MiB", async () => {
    expect(await renderVisualQualityViewports(HTML, {
      capture: async (_html, viewport) => viewport.width === 1280
        ? { mimeType: "image/jpeg", dataBase64: "" }
        : null,
    })).toBeNull();

    const oversized = Buffer.alloc(1024 * 1024 + 1).toString("base64");
    expect(await renderVisualQualityViewports(HTML, {
      capture: async () => ({ mimeType: "image/jpeg", dataBase64: oversized }),
    })).toBeNull();
  });

  it("uses one browser lifecycle and installs the SSRF guard before loading HTML", async () => {
    const order: string[] = [];
    let evaluations = 0;
    const page = {
      setViewport: vi.fn(async ({ width }: { width: number }) => { order.push(`viewport:${width}`); }),
      setContent: vi.fn(async () => { order.push("content"); }),
      // El programa de PULSAR llega como CADENA, no como función, y va DESPUÉS
      // de las dos capturas. Distinguirlo por su tipo es lo que fija que se
      // pulse al final y no en medio de las fotos.
      //
      // Las dos evaluaciones del sondeo de contraste se distinguen por su
      // código: son funciones, como las de geometría, así que el tipo no basta.
      // Que aparezcan DESPUÉS de las dos lecturas de desborde y ANTES de pulsar
      // es justo el orden que hay que sujetar.
      evaluate: vi.fn(async (arg: unknown) => {
        if (typeof arg === "string") { order.push("pulsar"); return 3; }
        const fuente = String(arg);
        if (fuente.includes("removeAttribute")) { order.push("restaurar"); return true; }
        // Cero candidatos: no hay nada que muestrear, así que no se toma
        // captura de sondeo y las dos entregables siguen siendo las únicas.
        if (fuente.includes("data-ol-sonda")) { order.push("sonda"); return []; }
        evaluations += 1; order.push(evaluations > 2 ? "overflow" : "settle"); return false;
      }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };
    const close = vi.fn(async () => { order.push("close"); });

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({
        newPage: async () => page,
        close,
      }),
      installGuard: async () => { order.push("guard"); },
      settle: async () => undefined,
    });

    expect(result).not.toBeNull();
    expect(order).toEqual([
      "guard", "viewport:1280", "content", "settle", "viewport:390", "settle", "overflow", "overflow",
      // El sondeo de contraste va DESPUÉS de la geometría —necesita el layout
      // asentado— y su restauración pega inmediatamente detrás: entre las dos
      // sólo cabe la captura PNG, así que el texto no puede quedarse apagado
      // para la foto que se le entrega al modelo.
      "sonda", "restaurar",
      // Los botones se aprietan al FINAL: un clic puede mover el DOM y las dos
      // capturas tienen que enseñar la página tal como se recibe.
      "pulsar",
      "close",
    ]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(page.screenshot).toHaveBeenCalledTimes(2);
    expect(page.screenshot).toHaveBeenNthCalledWith(1, expect.objectContaining({ clip: { x: 0, y: 0, width: 1280, height: 4096 } }));
    expect(page.screenshot).toHaveBeenNthCalledWith(2, expect.objectContaining({ clip: { x: 0, y: 0, width: 390, height: 4096 } }));
  });

  it("bounds a page taller than the inline-image limit at both viewports", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(6_400)
        .mockResolvedValueOnce(18_900)
        .mockResolvedValue({ rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390 }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).not.toBeNull();
    expect(page.screenshot).toHaveBeenNthCalledWith(1, expect.objectContaining({ clip: { x: 0, y: 0, width: 1280, height: 4096 } }));
    expect(page.screenshot).toHaveBeenNthCalledWith(2, expect.objectContaining({ clip: { x: 0, y: 0, width: 390, height: 4096 } }));
    expect(page.screenshot).not.toHaveBeenCalledWith(expect.objectContaining({ fullPage: true }));
  });

  it("captures a page shorter than the limit whole", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(1_540)
        .mockResolvedValueOnce(3_100)
        .mockResolvedValue({ rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390 }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(page.screenshot).toHaveBeenNthCalledWith(1, expect.objectContaining({ clip: { x: 0, y: 0, width: 1280, height: 1540 } }));
    expect(page.screenshot).toHaveBeenNthCalledWith(2, expect.objectContaining({ clip: { x: 0, y: 0, width: 390, height: 3100 } }));
  });

  it("derives invalid geometry from renderer measurements rather than non-empty screenshot bytes", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rootScrollWidth: Number.NaN, bodyScrollWidth: 390, clientWidth: 390 })
        .mockResolvedValueOnce({ rootScrollWidth: Number.NaN, bodyScrollWidth: 390, clientWidth: 390 }),
      screenshot: vi.fn(async () => Buffer.from("non-empty-valid-capture")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ invalidGeometry: true });
    expect(result?.desktop.dataBase64).not.toBe("");
    expect(result?.mobile.dataBase64).not.toBe("");
  });

  it("reports document-level horizontal overflow measured at the mobile viewport", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rootScrollWidth: 392, bodyScrollWidth: 390, clientWidth: 390 })
        .mockResolvedValueOnce({ rootScrollWidth: 392, bodyScrollWidth: 390, clientWidth: 390 }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ mobileOverflow: true });
    // 4 medidas + 2 del sondeo de contraste (recoger y restaurar) + 1 el
    // programa de pulsar, que es el único que llega como CADENA y va el último.
    expect(page.evaluate).toHaveBeenCalledTimes(7);
    expect(typeof page.evaluate.mock.calls[6]?.[0]).toBe("string");
  });

  it("tolerates one pixel of mobile layout rounding", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rootScrollWidth: 391, bodyScrollWidth: 390, clientWidth: 390 })
        .mockResolvedValueOnce({ rootScrollWidth: 391, bodyScrollWidth: 390, clientWidth: 390 }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ mobileOverflow: false });
  });

  it("reports materially weak mobile typography hierarchy from computed styles", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390,
          h1FontPx: 9, heroBodyFontPx: 4,
          componentCount: 4, roundedComponentCount: 4,
        })
        .mockResolvedValueOnce({
          rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390,
          h1FontPx: 9, heroBodyFontPx: 4,
          componentCount: 4, roundedComponentCount: 4,
        }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ weakTypographyHierarchy: true, squareComponentTreatment: false });
  });

  it("reports an essentially square set of visible components", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390,
          h1FontPx: 48, heroBodyFontPx: 17,
          componentCount: 4, roundedComponentCount: 0,
        })
        .mockResolvedValueOnce({
          rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390,
          h1FontPx: 48, heroBodyFontPx: 17,
          componentCount: 4, roundedComponentCount: 0,
        }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ weakTypographyHierarchy: false, squareComponentTreatment: true });
  });

  it("keeps image-only capture seams geometry-neutral", async () => {
    const result = await renderVisualQualityViewports(HTML, {
      capture: async () => ({ mimeType: "image/jpeg", dataBase64: Buffer.from("jpeg").toString("base64") }),
    });

    expect(result).not.toHaveProperty("mobileOverflow");
    expect(result).not.toHaveProperty("weakTypographyHierarchy");
    expect(result).not.toHaveProperty("squareComponentTreatment");
  });

  it("closes the browser and returns null when production capture throws", async () => {
    const close = vi.fn(async () => undefined);
    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({
        newPage: async () => ({
          setViewport: async () => undefined,
          setContent: async () => { throw new Error("render failed"); },
          evaluate: async () => undefined,
          screenshot: async () => Buffer.from("jpeg"),
        }),
        close,
      }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  // Los tres defectos que el booleano mezclaba. El reparador recibe el nombre y
  // los números, no la palabra "typography", que no dice cuál de los tres es.
  it.each([
    ["h1_too_small", { h1FontPx: 9, heroBodyFontPx: 4 }],
    ["hero_body_too_small", { h1FontPx: 48, heroBodyFontPx: 8 }],
    ["h1_not_dominant", { h1FontPx: 24, heroBodyFontPx: 20 }],
  ])("names %s instead of a bare typography flag", async (rule, fonts) => {
    const geometry = {
      rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390,
      ...fonts,
      componentCount: 4, roundedComponentCount: 4,
    };
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(geometry)
        .mockResolvedValueOnce(geometry),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({
      weakTypographyHierarchy: true,
      typographyHierarchy: { rule, h1FontPx: fonts.h1FontPx, heroBodyFontPx: fonts.heroBodyFontPx },
    });
  });

  it("leaves no finding behind when the hierarchy is sound", async () => {
    const geometry = {
      rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390,
      h1FontPx: 48, heroBodyFontPx: 17,
      componentCount: 4, roundedComponentCount: 4,
    };
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(geometry)
        .mockResolvedValueOnce(geometry),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ weakTypographyHierarchy: false, typographyHierarchy: null });
  });
});

// Con navegador de verdad: el selector es lo que se está probando, así que un
// evaluate simulado no probaría nada. Las 5 "jerarquías débiles" que salieron
// midiendo 20 páginas generadas eran esto — el kicker, no el cuerpo.
describe("qué párrafo es el cuerpo del hero", () => {
  const page = (ledePx: number) => `<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}
    .hero{padding:40px 20px}
    .hero h1{font-size:40px;margin:0}
    .kicker{font-size:11px;letter-spacing:.2em;text-transform:uppercase}
    .lede{font-size:${ledePx}px}
  </style></head><body><main class="hero">
    <p class="kicker">Club de comedia · CDMX</p>
    <h1>Risa Brava</h1>
    <p class="lede">Tres shows a la semana, cero filtros y una barra que nunca duerme, en el corazón de la ciudad.</p>
  </main></body></html>`;

  it("no confunde el kicker con el cuerpo", async () => {
    const result = await renderVisualQualityViewports(page(18));
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ weakTypographyHierarchy: false, typographyHierarchy: null });
  }, 30_000);

  it("sigue viendo un cuerpo de verdad ilegible", async () => {
    const result = await renderVisualQualityViewports(page(11));
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      weakTypographyHierarchy: true,
      typographyHierarchy: { rule: "hero_body_too_small", heroBodyFontPx: 11 },
    });
  }, 30_000);
});

// Con navegador de verdad, porque el defecto era del selector: `querySelector("h1")`
// devolvía nulo y nulo se leía como página sana. Medido: una baseline sin un
// solo <h1> pasaba el chequeo de jerarquía tipográfica.
describe("una página sin titular no es una página sana", () => {
  const SIN_H1 = `<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}
    .hero{padding:40px 20px}.lede{font-size:18px}
  </style></head><body><main class="hero">
    <p class="lede">Tres shows a la semana, cero filtros y una barra que nunca duerme.</p>
  </main></body></html>`;

  const H1_OCULTO = `<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}
    .hero{padding:40px 20px}.lede{font-size:18px}h1{display:none}
  </style></head><body><main class="hero">
    <h1>Risa Brava</h1>
    <p class="lede">Tres shows a la semana, cero filtros y una barra que nunca duerme.</p>
  </main></body></html>`;

  it("marca la ausencia total de titular", async () => {
    const result = await renderVisualQualityViewports(SIN_H1);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      weakTypographyHierarchy: true,
      typographyHierarchy: { rule: "h1_missing", h1Count: 0, h1FontPx: null },
    });
  }, 30_000);

  it("distingue un titular oculto de uno ausente", async () => {
    const result = await renderVisualQualityViewports(H1_OCULTO);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      weakTypographyHierarchy: true,
      typographyHierarchy: { rule: "h1_not_rendered", h1Count: 1, h1FontPx: null },
    });
  }, 30_000);
});

// 🔴 EL PUNTO CIEGO DEL CONTRASTE, con navegador de verdad porque lo que se
// prueba es la resolución del fondo REAL — un evaluate simulado no probaría nada.
//
// Medido el 2026-08-23 en una página real: el reloj de un pomodoro salía gris
// ilegible sobre un disco NEGRO y esto reportaba contraste PERFECTO. Lo que
// tapaba el texto no era un ancestro sino un `<svg>` HERMANO pintado detrás, y
// el paseo por `parentElement` no puede verlo por construcción.
describe("el fondo que pinta un HERMANO, no un ancestro", () => {
  // Calco del pomodoro: un <svg> en absoluto detrás y el texto encima, los dos
  // hijos del mismo contenedor transparente. Los <circle> sin `fill` se pintan
  // NEGROS por defecto — el defecto exacto que el modelo escribió.
  const pagina = (relleno: string) => `<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;background:#fff;font-family:Arial,sans-serif}
    .caja{position:relative;width:280px;height:280px;margin:600px auto}
    .caja svg{position:absolute;inset:0;width:100%;height:100%}
    .reloj{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:48px;color:#1f1e1b}
  </style></head><body>
    <h1 style="font-size:40px">Pomodoro</h1>
    <div class="caja">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" ${relleno}></circle></svg>
      <div class="reloj">25:00</div>
    </div>
  </body></html>`;

  it("ve el texto ilegible sobre el disco negro", async () => {
    const r = await renderVisualQualityViewports(pagina(""));
    expect(r).not.toBeNull();
    const hallazgos = r?.unreadableText ?? [];
    expect(hallazgos.some((h) => h.background === "#000000")).toBe(true);
  }, 30_000);

  // El brazo de control: la MISMA página con el relleno puesto no puede dar
  // ningún hallazgo. Sin esto, un detector que dijera "ilegible" siempre
  // pasaría la prueba de arriba sin proteger nada.
  it("y con fill=none no inventa ninguno", async () => {
    const r = await renderVisualQualityViewports(pagina('fill="none" stroke="#ccc"'));
    expect(r).not.toBeNull();
    expect(r?.unreadableText ?? []).toEqual([]);
  }, 30_000);

  // El falso positivo que mi primera versión sí generaba: saltarse los
  // ancestros mandaba el paseo hasta el <body> y medía el texto claro de un
  // botón contra el fondo de la página en vez de contra su propio acento.
  it("un botón de acento NO es un hallazgo — su propio fondo manda", async () => {
    const html = `<!doctype html><html><head><style>
      html,body{margin:0;background:#f7f5f0;font-family:Arial,sans-serif}
      .btn{display:inline-block;margin:600px 40px;padding:14px 22px;border-radius:99px;background:#b4472a;color:#fdfcf9;font-size:16px}
    </style></head><body><h1 style="font-size:40px">Hola</h1>
      <a class="btn" href="#x">empezar ahora</a></body></html>`;
    const r = await renderVisualQualityViewports(html);
    expect(r).not.toBeNull();
    expect(r?.unreadableText ?? []).toEqual([]);
  }, 30_000);
});

// APRETAR LOS BOTONES, con navegador de verdad. Los ojos del Agente pulsan
// desde el 22/08; una página recién CREADA nunca veía un clic — nacía, se
// fotografiaba y se entregaba. Este es el modo de fallo que sólo se ve así.
describe("los controles se aprietan al medir", () => {
  const pagina = (cuerpo: string) => `<!doctype html><html><head><style>
      body{margin:0;font-family:Arial,sans-serif;background:#fff;color:#111}
    </style></head><body>
    <h1 style="font-size:40px">Contador</h1>
    <button id="b" style="font-size:16px">sumar</button>
    <span id="n" style="font-size:16px">0</span>
    <script>${cuerpo}</script>
  </body></html>`;

  it("caza el manejador que revienta en la SEGUNDA jugada", async () => {
    // Carga limpio, la captura sale perfecta y la consola está muda hasta que
    // alguien pulsa dos veces. Sin pulsar, esta página pasa por sana.
    const r = await renderVisualQualityViewports(
      pagina(`var v=0;document.getElementById("b").addEventListener("click",function(){
        v++; if (v>1) { null.x = 1; } document.getElementById("n").textContent=String(v);
      });`),
    );
    expect(r).not.toBeNull();
    expect((r?.runtimeErrors ?? []).join(" ")).toMatch(/null|undefined|TypeError/i);
  }, 30_000);

  // El brazo de control: sin él, un detector que dijera "roto" siempre pasaría
  // la prueba de arriba sin proteger nada.
  it("y un botón que funciona no inventa ningún grito", async () => {
    const r = await renderVisualQualityViewports(
      pagina(`var v=0;document.getElementById("b").addEventListener("click",function(){
        v++; document.getElementById("n").textContent=String(v);
      });`),
    );
    expect(r).not.toBeNull();
    expect(r?.runtimeErrors ?? []).toEqual([]);
  }, 30_000);
});

// EL GUION DEL MODELO ocupa el mismo hueco que el pulsado a ciegas: mismo
// navegador, después de las dos capturas. Lo que se prueba aquí es la ELECCIÓN
// (guion o pulsado, nunca los dos) y que lo que devuelve el navegador llega
// intacto a quien lo pidió — este módulo no interpreta specs.
describe("el guion declarado por el modelo", () => {
  const GUION = "(() => [[0, '#reloj no cambió']])();";

  const doble = (alEvaluarCadena: (arg: string) => unknown) => ({
    setViewport: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    evaluate: vi.fn(async (arg: unknown) =>
      typeof arg === "string" ? alEvaluarCadena(arg) : undefined,
    ),
    screenshot: vi.fn(async () => Buffer.from("jpeg")),
  });

  const conPagina = (page: ReturnType<typeof doble>, opts: { behaviorProgram?: string }) =>
    renderVisualQualityViewports(
      HTML,
      {
        launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
        installGuard: async () => undefined,
        settle: async () => undefined,
      },
      opts,
    );

  it("ejecuta el guion y devuelve lo crudo, sin interpretarlo", async () => {
    const page = doble(() => [[0, "#reloj no cambió"]]);
    const r = await conPagina(page, { behaviorProgram: GUION });
    expect(r?.behaviorResult).toEqual([[0, "#reloj no cambió"]]);
  });

  it("con guion NO se pulsa a ciegas — es una cosa o la otra", async () => {
    const page = doble(() => []);
    await conPagina(page, { behaviorProgram: GUION });
    const cadenas = page.evaluate.mock.calls.map((c) => c[0]).filter((a) => typeof a === "string");
    expect(cadenas).toEqual([GUION]);
  });

  it("sin guion se pulsa como siempre y no hay resultado que leer", async () => {
    const page = doble(() => 3);
    const r = await conPagina(page, {});
    const cadenas = page.evaluate.mock.calls.map((c) => c[0]).filter((a) => typeof a === "string");
    expect(cadenas).toHaveLength(1);
    expect(cadenas[0]).not.toBe(GUION);
    // Ausente, no `undefined` explícito: el objeto queda idéntico al de antes
    // de que esto existiera.
    expect("behaviorResult" in (r ?? {})).toBe(false);
  });

  it("un guion que revienta no cuesta la medición", async () => {
    const page = doble(() => {
      throw new Error("boom");
    });
    const r = await conPagina(page, { behaviorProgram: GUION });
    expect(r).not.toBeNull();
    expect(r?.desktop.dataBase64).not.toBe("");
    expect("behaviorResult" in (r ?? {})).toBe(false);
  });
});

// ─── LA CAPTURA DE SONDEO ────────────────────────────────────────────────────
//
// Los dobles de arriba no la ven, y no es un descuido: devuelven geometría para
// CUALQUIER evaluación, así que la recogida da cero candidatos — y sin nada que
// muestrear la captura de sondeo no se toma. Eso es correcto: una página sin
// texto medible no paga los ~200 ms. Estas dos pruebas recorren el otro camino.
describe("la captura de sondeo del contraste", () => {
  const CANDIDATO = {
    texto: "Mariscos frescos desde 1987",
    etiqueta: "p",
    color: "rgb(255, 255, 255)",
    probe: -1,
    puntos: [[1, 1]],
    fondoCss: "rgb(255, 255, 255)",
    velos: [],
  };

  const dobleConCandidatos = (screenshot: (opts: { type: string }) => Promise<Buffer>) => ({
    setViewport: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    evaluate: vi.fn(async (arg: unknown) => {
      const fuente = String(arg);
      if (typeof arg !== "string" && fuente.includes("removeAttribute")) return true;
      if (typeof arg !== "string" && fuente.includes("data-ol-sonda")) return [CANDIDATO];
      return { rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390 };
    }),
    screenshot: vi.fn(screenshot),
  });

  const correr = (page: ReturnType<typeof dobleConCandidatos>) =>
    renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

  it("va entre las dos entregables, es PNG y no pide calidad", async () => {
    const page = dobleConCandidatos(async () => Buffer.from("jpeg"));
    await correr(page);

    expect(page.screenshot).toHaveBeenCalledTimes(3);
    expect(page.screenshot).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "jpeg" }));
    // PNG y SIN `quality`: hay que leer píxeles exactos —JPEG destroza justo
    // eso— y puppeteer lanza si se le manda calidad con PNG.
    const sondeo = page.screenshot.mock.calls[1][0] as Record<string, unknown>;
    expect(sondeo.type).toBe("png");
    expect(sondeo).not.toHaveProperty("quality");
    // Mismo recorte que la entregable móvil: los puntos vienen en coordenadas
    // de documento y tienen que caer dentro de ESTA imagen.
    expect(sondeo.clip).toEqual({ x: 0, y: 0, width: 390, height: 4096 });
    expect(page.screenshot).toHaveBeenNthCalledWith(3, expect.objectContaining({ type: "jpeg" }));
  });

  // 🔴 EL FALLO CATASTRÓFICO QUE ESTO IMPIDE: si la hoja que apaga el texto
  // sobreviviera a una excepción, la captura que se le ENTREGA AL MODELO
  // saldría en blanco y le pediríamos que arreglara una página que no existe.
  // Por eso la restauración vive en un `finally`.
  it("restaura el texto aunque la captura de sondeo reviente, y cae al respaldo", async () => {
    const page = dobleConCandidatos(async (opts) => {
      if (opts.type === "png") throw new Error("la captura de sondeo reventó");
      return Buffer.from("jpeg");
    });
    const resultado = await correr(page);

    // El informe sale igual que antes de que el muestreo existiera: el
    // candidato cae a su `fondoCss` —blanco sobre blanco— y sigue siendo un
    // hallazgo. Fallar hacia lo de antes.
    expect(resultado?.unreadableText ?? []).toHaveLength(1);
    expect((resultado?.unreadableText ?? [])[0]).toMatchObject({ background: "#ffffff", contrast: 1 });
    // Y el programa de restaurar SÍ se ejecutó, pese a la excepción.
    const restauraciones = page.evaluate.mock.calls
      .map((c) => String(c[0]))
      .filter((fuente) => fuente.includes("removeAttribute"));
    expect(restauraciones).toHaveLength(1);
  });
});

// ─── FALLAR HACIA LO DE ANTES, CON NAVEGADOR DE VERDAD ───────────────────────
//
// El paseo por píxeles manda, pero si la captura de sondeo no se puede leer
// —bytes corruptos, un formato que el decodificador no entiende, la captura que
// lanza— el informe tiene que salir IGUAL que antes de que el muestreo
// existiera, no vacío. Es la propiedad que hace seguro añadir todo esto.
//
// La prueba con dobles de más arriba fija el CABLE (que se restaura, que se cae
// al respaldo). Ésta fija lo otro: que los dos paseos por CSS, con CSS de
// verdad en un Chromium de verdad, siguen sabiendo hacer su trabajo. Sin ella,
// «cae al respaldo» sólo estaría probado contra un `fondoCss` que le pasamos
// nosotros a mano.
describe("el respaldo cuando el píxel no se puede leer", () => {
  const DOC = `<!doctype html><html><head><style>
    body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
  </style></head><body>
    <p style="color:#ffffff;background:#ffffff;padding:20px">Mariscos frescos desde 1987</p>
    <p style="color:#111111;background:#ffffff;padding:20px">Este se lee perfectamente</p>
  </body></html>`;

  it("cae al paseo por CSS y sigue distinguiendo lo invisible de lo legible", async () => {
    const puppeteer = (await import("puppeteer")).default;
    const navegador = await puppeteer.launch({ headless: true });
    let ultimaPagina: Awaited<ReturnType<typeof navegador.newPage>> | null = null;
    try {
      const resultado = await renderVisualQualityViewports(DOC, {
        launchBrowser: async () => ({
          newPage: async () => {
            const pagina = await navegador.newPage();
            ultimaPagina = pagina;
            const original = pagina.screenshot.bind(pagina);
            // Sólo la captura de SONDEO devuelve basura. Las dos entregables
            // siguen siendo reales, para no romper el resto del informe.
            (pagina as unknown as { screenshot: unknown }).screenshot = async (opts: { type: string }) =>
              opts.type === "png" ? Buffer.from("no soy un png") : original(opts as never);
            return pagina as never;
          },
          close: async () => undefined,
        }),
      });

      const malos = resultado?.unreadableText ?? [];
      expect(malos.some((m) => (m.texto ?? "").includes("Mariscos")), `salió: ${JSON.stringify(malos)}`).toBe(true);
      expect(malos.some((m) => (m.texto ?? "").includes("perfectamente"))).toBe(false);

      // 🔴 Y LA RESTAURACIÓN SURTIÓ EFECTO, no sólo «se llamó». Que el programa
      // se evalúe lo fija una prueba con dobles más arriba; esto fija lo que de
      // verdad importa: que en la página REAL no queda ni la hoja que apaga el
      // texto ni un solo atributo marcado. Si sobreviviera, la captura que se
      // le entrega al modelo saldría en blanco y le pediríamos que arreglara
      // una página que no existe — el único fallo aquí que es catastrófico.
      //
      // Se puede comprobar porque el `close` de arriba es nuestro y no cierra
      // nada: la página sigue viva después del render. Y se comprueba en el
      // camino de FALLO, que es donde un `finally` mal puesto se nota.
      const limpia = await ultimaPagina!.evaluate(() => ({
        hoja: document.getElementById("ol-sonda-contraste") !== null,
        marcados: document.querySelectorAll("[data-ol-sonda]").length,
        // Y el texto vuelve a tener color de verdad, no `transparent`.
        colorDelPrimero: window.getComputedStyle(document.querySelector("p")!).color,
      }));
      expect(limpia.hoja, "la hoja que apaga el texto sobrevivió al render").toBe(false);
      expect(limpia.marcados, "quedaron elementos marcados con data-ol-sonda").toBe(0);
      expect(limpia.colorDelPrimero).not.toBe("rgba(0, 0, 0, 0)");
    } finally {
      await navegador.close();
    }
  }, 60_000);
});

// ─── UNA MEDIDA QUE NO SE PUDO TOMAR NO ES UNA PÁGINA SANA ───────────────────
//
// 🔴 Los dos paseos por CSS viven DENTRO del programa de recogida, así que si
// ése revienta no queda respaldo: el informe sale con cero hallazgos de
// contraste, que es indistinguible de una página limpia. Antes de medir por
// píxeles ese fallo era ruidoso. Estas dos pruebas fijan que los dos modos de
// fallo se distinguen y que ninguno es mudo.
describe("cuando la medición de contraste no se puede tomar", () => {
  const doble = (evaluate: (arg: unknown) => Promise<unknown>) => ({
    setViewport: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    evaluate: vi.fn(evaluate),
    screenshot: vi.fn(async () => Buffer.from("jpeg")),
  });

  const correr = (page: ReturnType<typeof doble>) =>
    renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

  it("dice que NO pudo medir, en vez de callar como si estuviera sana", async () => {
    const avisos: string[] = [];
    const espia = vi.spyOn(console, "warn").mockImplementation((m: unknown) => { avisos.push(String(m)); });
    try {
      const page = doble(async (arg) => {
        if (typeof arg !== "string" && String(arg).includes("data-ol-sonda")) throw new Error("el programa de recogida reventó");
        return { rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390 };
      });
      const resultado = await correr(page);
      // El resto del informe sobrevive: degradar una medida no puede costar el
      // desborde, la jerarquía ni los errores de JavaScript.
      expect(resultado).not.toBeNull();
      expect(resultado?.unreadableText ?? []).toEqual([]);
      // Y el cero se explica.
      expect(avisos.join(" ")).toMatch(/la recogida de contraste falló/);
      expect(avisos.join(" ")).toMatch(/NO significa que la página esté sana/);
    } finally {
      espia.mockRestore();
    }
  });

  // BRAZO DE CONTROL: el otro modo de fallo NO dice lo mismo, porque no es lo
  // mismo. Con el sondeo caído sí hay respaldo, y el informe sigue valiendo.
  it("y distingue el sondeo caído —que sí tiene respaldo— de la recogida caída", async () => {
    const avisos: string[] = [];
    const espia = vi.spyOn(console, "warn").mockImplementation((m: unknown) => { avisos.push(String(m)); });
    try {
      const page = {
        setViewport: vi.fn(async () => undefined),
        setContent: vi.fn(async () => undefined),
        evaluate: vi.fn(async (arg: unknown) => {
          const fuente = String(arg);
          if (typeof arg !== "string" && fuente.includes("removeAttribute")) return true;
          if (typeof arg !== "string" && fuente.includes("data-ol-sonda")) {
            return [{ texto: "Mariscos", etiqueta: "p", color: "rgb(255, 255, 255)", probe: -1, puntos: [[1, 1]], fondoCss: "rgb(255, 255, 255)", velos: [] }];
          }
          return { rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390 };
        }),
        screenshot: vi.fn(async (opts: { type: string }) => {
          if (opts.type === "png") throw new Error("la captura de sondeo reventó");
          return Buffer.from("jpeg");
        }),
      };
      const resultado = await correr(page);
      // El respaldo por CSS sigue produciendo el hallazgo.
      expect(resultado?.unreadableText ?? []).toHaveLength(1);
      expect(avisos.join(" ")).toMatch(/el sondeo por píxeles falló/);
      expect(avisos.join(" ")).not.toMatch(/NO significa que la página esté sana/);
    } finally {
      espia.mockRestore();
    }
  });
});
