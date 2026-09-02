// @vitest-environment node
//
// Se mockea `@/lib/templates/store` porque su cadena de imports llega a
// `admin-schemas` → `sanitizeForPublish` → el binding nativo @openlen/html-engine,
// que vitest no puede cargar (mismo motivo que el test de live-republish).
// `findTemplateHtmlIssue` se mockea por lo mismo; su comportamiento real ya lo
// cubren las pruebas de admin-schemas.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const upsertTemplate = vi.fn();
const getTemplate = vi.fn();
const findTemplateHtmlIssue = vi.fn((_input: unknown): { where: string; reason: string } | null => null);

vi.mock("@/lib/templates/store", () => ({
  getTemplate: (...a: unknown[]) => getTemplate(...a),
  upsertTemplate: (...a: unknown[]) => upsertTemplate(...a),
}));
vi.mock("@/lib/templates/admin-schemas", () => ({
  findTemplateHtmlIssue: (a: unknown) => findTemplateHtmlIssue(a),
}));

import { POST } from "./route";
import { hashDeContenido } from "@/lib/templates/republicar-desde-disco";

const SECRETO = "s3cr3t";
const LIMPIA = `<!doctype html><html><body><form><button>Enviar</button></form></body></html>`;
const SUCIA = `<!doctype html><html><body><form onsubmit="return false"><button>Enviar</button></form></body></html>`;

const post = (headers: Record<string, string> = {}, body?: unknown) =>
  POST(
    new Request("http://x/api/internal/republish-templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

const conSecreto = (body?: unknown) => post({ "x-internal-secret": SECRETO }, body);

/** Una carpeta de fuentes de mentira, y el cwd apuntando a su padre. */
async function montarFuentes(ficheros: Record<string, string>): Promise<string> {
  const raiz = await mkdtemp(join(tmpdir(), "republish-"));
  const dir = join(raiz, "templates-starter");
  await import("node:fs/promises").then((fs) => fs.mkdir(dir));
  for (const [nombre, html] of Object.entries(ficheros)) {
    await writeFile(join(dir, nombre), html, "utf8");
  }
  vi.spyOn(process, "cwd").mockReturnValue(raiz);
  return dir;
}

const registro = (id: string, html: string) => ({
  id,
  name: id,
  family: "editorial",
  accent: "#FF5A36",
  pitch: "p",
  description: "d",
  mode: "light",
  visualMetadata: null,
  pages: [{ slug: "menu", html: "<p>menu</p>" }],
  status: "published",
  contentHash: hashDeContenido(html),
  storageUrl: `https://x/${id}.html`,
  storageKey: `templates/${id}.html`,
  size: html.length,
});

describe("POST /api/internal/republish-templates", () => {
  beforeEach(() => {
    delete process.env.OPENLEN_TEMPLATES_DIR;
    process.env.OPENLEN_INTERNAL_SECRET = SECRETO;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    findTemplateHtmlIssue.mockReturnValue(null);
  });

  it("401 sin header de secreto", async () => {
    expect((await post()).status).toBe(401);
  });

  it("401 con el secreto equivocado", async () => {
    expect((await post({ "x-internal-secret": "nope" })).status).toBe(401);
  });

  it("401 si el secreto del entorno no está puesto (fail-closed)", async () => {
    delete process.env.OPENLEN_INTERNAL_SECRET;
    expect((await conSecreto()).status).toBe(401);
  });

  // EN SECO POR DEFECTO. Escribe en la galería de producción: que haga falta
  // pedirlo dos veces es la diferencia entre una herramienta y un accidente.
  it("sin cuerpo va en SECO y no escribe nada", async () => {
    await montarFuentes({ "cumbre.html": LIMPIA });
    getTemplate.mockResolvedValue(registro("cumbre", SUCIA));

    const json = await (await conSecreto()).json();

    expect(json.seco).toBe(true);
    expect(json.seRepublicarian).toEqual(["cumbre"]);
    expect(upsertTemplate).not.toHaveBeenCalled();
  });

  it("con aplicar:true republica la que derivó, conservando su metadata y sus subpáginas", async () => {
    await montarFuentes({ "cumbre.html": LIMPIA });
    getTemplate.mockResolvedValue(registro("cumbre", SUCIA));
    upsertTemplate.mockResolvedValue({
      contentHash: hashDeContenido(LIMPIA),
      storageUrl: "https://x/cumbre-nuevo.html",
    });

    const json = await (await conSecreto({ aplicar: true })).json();

    expect(json.republicadas).toBe(1);
    expect(json.fallidas).toEqual([]);
    const arg = upsertTemplate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.html).toBe(LIMPIA);
    // `upsert` SIEMPRE escribe `pages`: omitirla dejaría una multipágina
    // reducida a su portada.
    expect(arg.pages).toEqual([{ slug: "menu", html: "<p>menu</p>" }]);
    expect(arg.status).toBe("published");
    expect(arg.name).toBe("cumbre");
  });

  it("la que YA coincide con la galería no se toca", async () => {
    await montarFuentes({ "mirror.html": LIMPIA });
    getTemplate.mockResolvedValue(registro("mirror", LIMPIA));

    const json = await (await conSecreto({ aplicar: true })).json();

    expect(json.republicadas).toBe(0);
    expect(upsertTemplate).not.toHaveBeenCalled();
  });

  // Los `.preview.html` son la vista previa, no el cuerpo publicable — y son
  // justo donde viven los `onerror` que quedan.
  it("ignora los .preview.html", async () => {
    await montarFuentes({ "arcana.html": LIMPIA, "arcana.preview.html": SUCIA });
    getTemplate.mockResolvedValue(registro("arcana", LIMPIA));

    const json = await (await conSecreto()).json();

    expect(json.enDisco).toBe(1);
    expect(getTemplate).toHaveBeenCalledTimes(1);
    expect(getTemplate).toHaveBeenCalledWith("arcana");
  });

  it("un html que no pasa el validador no se sube y se dice cuál", async () => {
    await montarFuentes({ "cumbre.html": LIMPIA });
    getTemplate.mockResolvedValue(registro("cumbre", SUCIA));
    findTemplateHtmlIssue.mockReturnValue({ where: "html", reason: "on* prohibido" } as never);

    const json = await (await conSecreto({ aplicar: true })).json();

    expect(json.ok).toBe(false);
    expect(json.republicadas).toBe(0);
    expect(json.fallidas[0].id).toBe("cumbre");
    expect(upsertTemplate).not.toHaveBeenCalled();
  });

  // Dejar 18 sin republicar porque la 19 tropezó es peor que republicar 18 y
  // decir cuál falló.
  it("una que falla no para a las demás", async () => {
    await montarFuentes({ "albor.html": LIMPIA, "cumbre.html": LIMPIA });
    getTemplate.mockImplementation(async (id: string) => registro(id, SUCIA));
    upsertTemplate
      .mockRejectedValueOnce(new Error("R2 se cayó"))
      .mockResolvedValueOnce({ contentHash: "h", storageUrl: "u" });

    const json = await (await conSecreto({ aplicar: true })).json();

    expect(json.republicadas).toBe(1);
    expect(json.fallidas).toHaveLength(1);
    expect(json.ok).toBe(false);
  });

  it("sin carpeta de fuentes lo dice con la pista, no con un 500 mudo", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(join(tmpdir(), "no-existe-nada-aqui"));
    const res = await conSecreto();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("sin_fuentes");
  });
});
