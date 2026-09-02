import { describe, expect, it, vi } from "vitest";

import { MAX_TEXTO, MAX_URLS, htmlATexto, leerDeInternet, type Fetcher } from "./internet";

/** Un fetcher de mentira: devuelve el HTML que se le diga por URL, o un error. */
function fetcherDe(
  tabla: Record<string, string | { kind: string; [k: string]: unknown }>,
  espia?: (url: string) => void,
): Fetcher {
  return (async ({ url }: { url: string }) => {
    espia?.(url);
    const v = tabla[url];
    if (v === undefined) return { ok: false as const, error: { kind: "network", message: "sin ruta" } };
    if (typeof v !== "string") return { ok: false as const, error: v };
    return {
      ok: true as const,
      value: {
        url,
        hostname: new URL(url).hostname,
        finalUrl: url,
        html: v,
        rendered: false,
        fetchedAt: new Date(),
        tier: 1,
        durationMs: 1,
        sizeBytes: v.length,
      },
    };
  }) as unknown as Fetcher;
}

describe("htmlATexto", () => {
  it("saca el texto que una persona leería, con su título", () => {
    const { titulo, texto } = htmlATexto(
      `<!doctype html><html><head><title>Bar Paco</title></head><body>
        <h1>Bar Paco</h1><p>Abrimos de 8 a 23.</p></body></html>`,
    );
    expect(titulo).toBe("Bar Paco");
    expect(texto).toContain("Bar Paco");
    expect(texto).toContain("Abrimos de 8 a 23.");
  });

  // 🔴 EL CSS Y EL JS NO SON TEXTO. Sobre una página con Tailwind inline eso son
  // decenas de miles de caracteres que se comerían el tope antes de llegar al
  // primer párrafo — el modelo recibiría reglas de CSS en vez de los horarios.
  it("NO trae el <style> ni el <script>", () => {
    const { texto } = htmlATexto(
      `<html><head><style>.x{color:red}</style></head><body>
        <script>var secreto = 1;</script><p>Hola</p></body></html>`,
    );
    expect(texto).toBe("Hola");
  });

  it("no repite el texto una vez por cada antepasado", () => {
    // `document.text` devolvería «Hola» tres veces (body, div, p).
    const { texto } = htmlATexto(`<html><body><div><p>Hola</p></div></body></html>`);
    expect(texto).toBe("Hola");
  });

  // El pie se QUEDA: el teléfono y los horarios de un negocio viven ahí más
  // veces que en ningún otro sitio.
  it("conserva el pie y la navegación", () => {
    const { texto } = htmlATexto(
      `<html><body><nav>Carta</nav><footer>Tel 600112233</footer></body></html>`,
    );
    expect(texto).toContain("Carta");
    expect(texto).toContain("600112233");
  });
});

describe("leerDeInternet", () => {
  const pagina = (t: string) => `<html><head><title>T</title></head><body><p>${t}</p></body></html>`;

  it("lee varias direcciones y devuelve el texto de cada una", async () => {
    const r = await leerDeInternet(["https://a.com", "https://b.com"], {
      fetcher: fetcherDe({ "https://a.com": pagina("uno"), "https://b.com": pagina("dos") }),
    });
    expect(r.map((x) => (x.ok ? x.texto : x.error))).toEqual(["uno", "dos"]);
  });

  // 🔴 EN PARALELO, y no es cosmético: tres lecturas en serie son tres plazos de
  // fetch encadenados con el usuario mirando una pantalla quieta.
  it("las lanza A LA VEZ, no una detrás de otra", async () => {
    let vivas = 0;
    let maximoALaVez = 0;
    const lento: Fetcher = (async ({ url }: { url: string }) => {
      vivas += 1;
      maximoALaVez = Math.max(maximoALaVez, vivas);
      await new Promise((r) => setTimeout(r, 10));
      vivas -= 1;
      return {
        ok: true as const,
        value: {
          url, hostname: "x", finalUrl: url, html: pagina("x"), rendered: false,
          fetchedAt: new Date(), tier: 1, durationMs: 1, sizeBytes: 1,
        },
      };
    }) as unknown as Fetcher;

    await leerDeInternet(["https://a.com", "https://b.com", "https://c.com"], { fetcher: lento });

    expect(maximoALaVez).toBe(3);
  });

  // 🔴 UNA URL MUERTA NO SE LLEVA LAS OTRAS. Con promesas que rechazaran, un
  // enlace roto tiraría las dos lecturas que sí valían y el turno se quedaría
  // sin nada.
  it("una que falla no tumba a las demás, y dice POR QUÉ falló", async () => {
    const r = await leerDeInternet(["https://a.com", "https://mala.com", "https://c.com"], {
      fetcher: fetcherDe({
        "https://a.com": pagina("uno"),
        "https://mala.com": { kind: "ssrf-blocked", reason: "privada" },
        "https://c.com": pagina("tres"),
      }),
    });
    expect(r[0]!.ok).toBe(true);
    expect(r[1]!.ok).toBe(false);
    expect(r[2]!.ok).toBe(true);
    // El motivo REAL: «no se pudo leer» le manda a reintentar lo que nunca va a
    // funcionar.
    expect(r[1]!.ok === false && r[1]!.error).toMatch(/no es una web pública/);
  });

  it("un muro anti-bot se dice como tal, con la instrucción de no insistir", async () => {
    const r = await leerDeInternet(["https://a.com"], {
      fetcher: fetcherDe({ "https://a.com": { kind: "challenge", reason: "cf" } }),
    });
    expect(r[0]!.ok === false && r[0]!.error).toMatch(/no insistas/);
  });

  it("y un fetcher que REVIENTA tampoco se lleva las otras", async () => {
    const explota: Fetcher = (async ({ url }: { url: string }) => {
      if (url === "https://boom.com") throw new Error("boom");
      return {
        ok: true as const,
        value: {
          url, hostname: "x", finalUrl: url, html: pagina("bien"), rendered: false,
          fetchedAt: new Date(), tier: 1, durationMs: 1, sizeBytes: 1,
        },
      };
    }) as unknown as Fetcher;
    const r = await leerDeInternet(["https://boom.com", "https://ok.com"], { fetcher: explota });
    expect(r[0]!.ok).toBe(false);
    expect(r[1]!.ok).toBe(true);
  });

  it(`corta en ${MAX_URLS} direcciones`, async () => {
    const vistas: string[] = [];
    await leerDeInternet(
      ["https://a.com", "https://b.com", "https://c.com", "https://d.com", "https://e.com"],
      { fetcher: fetcherDe({}, (u) => vistas.push(u)) },
    );
    expect(vistas).toHaveLength(MAX_URLS);
  });

  it("recorta el texto largo y LO DICE", async () => {
    const largo = "palabra ".repeat(5_000);
    const r = await leerDeInternet(["https://a.com"], {
      fetcher: fetcherDe({ "https://a.com": pagina(largo) }),
    });
    expect(r[0]!.ok && r[0]!.texto.length).toBe(MAX_TEXTO);
    // Dicho, no escondido: el modelo tiene que saber que lo que ve no es todo.
    expect(r[0]!.ok && r[0]!.recortado).toBe(true);
  });

  it("una lista vacía no llama a nadie", async () => {
    const fetcher = vi.fn();
    const r = await leerDeInternet(["", "   "], { fetcher: fetcher as unknown as Fetcher });
    expect(r).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
