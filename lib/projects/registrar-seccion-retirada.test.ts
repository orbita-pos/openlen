// `registrarSeccionRetirada` escribe dentro del blob `data`, que es donde vive
// la página entera. Un `set({ data: { degradations: [...] } })` descuidado se
// llevaría html, pages y settings por delante — el proyecto completo— para dejar
// constancia de que se cayó una sección. Esto fija que MEZCLA.
//
// Y fija la decisión que no es obvia: la banda vive en `data.html` para siempre,
// así que esta limpieza corre en CADA publicación. Si cada publicación re-abriera
// el aviso, un aviso honesto se convertiría en un fastidio permanente.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mocks.select, update: mocks.update },
  schema: { projects: { id: "id", userId: "userId", data: "data" } },
}));

import { registrarSeccionRetirada } from "@/lib/projects";

const DATA_COMPLETA = {
  html: "<!doctype html><html><body>la página</body></html>",
  pages: { tienda: { html: "<html>tienda</html>" } },
  settings: { whatsapp: { number: "521" } },
};

function conData(data: Record<string, unknown>) {
  mocks.select.mockReturnValue({
    from: () => ({ where: () => ({ limit: async () => [{ data }] }) }),
  });
}

const escrito = () =>
  (mocks.set.mock.calls[0][0] as { data: Record<string, unknown> }).data;

describe("registrarSeccionRetirada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returning.mockResolvedValue([{ id: "p1" }]);
    mocks.where.mockReturnValue({ returning: mocks.returning });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.update.mockReturnValue({ set: mocks.set });
    conData(DATA_COMPLETA);
  });

  it("deja el acta sin tocar el resto del proyecto", async () => {
    expect(await registrarSeccionRetirada("p1", ["comments"])).toBe(true);

    const w = escrito();
    expect(w.html).toBe(DATA_COMPLETA.html);
    expect(w.pages).toEqual(DATA_COMPLETA.pages);
    expect(w.settings).toEqual(DATA_COMPLETA.settings);
    expect(w.degradations).toEqual([
      {
        surface: "publish",
        stage: "publish",
        code: "section_removed",
        count: 1,
        detail: ["comments"],
      },
    ]);
  });

  it("sin módulos no escribe nada — vacío es el caso normal", async () => {
    expect(await registrarSeccionRetirada("p1", [])).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("no pisa las degradaciones de otros códigos", async () => {
    const previa = { surface: "from-html", stage: "sanitize", code: "scripts", count: 2 };
    conData({ ...DATA_COMPLETA, degradations: [previa] });

    await registrarSeccionRetirada("p1", ["bookings"]);

    const w = escrito() as { degradations: unknown[] };
    expect(w.degradations[0]).toEqual(previa);
    expect(w.degradations).toHaveLength(2);
  });

  it("REEMPLAZA su propio aviso anterior en vez de acumularlo", async () => {
    conData({
      ...DATA_COMPLETA,
      degradations: [
        {
          surface: "publish",
          stage: "publish",
          code: "section_removed",
          count: 1,
          detail: ["comments"],
        },
      ],
    });

    await registrarSeccionRetirada("p1", ["comments", "bookings"]);

    const w = escrito() as { degradations: Array<{ detail: string[] }> };
    expect(w.degradations).toHaveLength(1);
    expect(w.degradations[0].detail).toEqual(["bookings", "comments"]);
  });

  it("no re-interrumpe al dueño que YA cerró este mismo aviso", async () => {
    conData({
      ...DATA_COMPLETA,
      degradations: [
        {
          surface: "publish",
          stage: "publish",
          code: "section_removed",
          count: 1,
          detail: ["comments"],
        },
      ],
      degradationsDismissed: true,
    });

    await registrarSeccionRetirada("p1", ["comments"]);

    // La banda se vuelve a caer en cada publicación — no puede no caerse. Si
    // esto pusiera `false`, el aviso reaparecería para siempre.
    expect(escrito().degradationsDismissed).toBe(true);
  });

  it("pero SÍ vuelve a avisar cuando la pérdida es NUEVA", async () => {
    conData({
      ...DATA_COMPLETA,
      degradations: [
        {
          surface: "publish",
          stage: "publish",
          code: "section_removed",
          count: 1,
          detail: ["comments"],
        },
      ],
      degradationsDismissed: true,
    });

    await registrarSeccionRetirada("p1", ["comments", "bookings"]);

    expect(escrito().degradationsDismissed).toBe(false);
  });

  it("un proyecto que no existe no escribe", async () => {
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });

    expect(await registrarSeccionRetirada("p1", ["comments"])).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
