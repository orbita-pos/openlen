import { describe, expect, it, vi } from "vitest";

import { preparePage } from "./prepare";

const PAGE = `<!doctype html><html><head><style>:root{--ol-fg:#111}</style></head><body><section><h2>Hola</h2></section></body></html>`;

/**
 * La puerta real hace I/O nativo, pero el doble tiene que respetar su contrato:
 * llama a `beforeMeta`, que es donde corren los invariantes. Un doble que lo
 * ignore prueba una tubería que no existe.
 */
const gateOk = vi.fn(
  async (html: string, deps: { beforeMeta?: (h: string) => string }, _policy: unknown) => ({
    ok: true as const,
    html: deps.beforeMeta ? deps.beforeMeta(html) : html,
    removed: { scripts: 0, eventHandlers: 0, iframes: 0, dangerousUrls: 0 },
    warnings: [] as string[],
  }),
);

const deps = (over: Parameters<typeof preparePage>[2] = {}) => ({
  render: (async () => ({ mobileOverflow: false, invalidGeometry: false })) as never,
  photograph: (async ({ html }: { html: string }) => ({ html, applied: 0 })) as never,
  gate: gateOk as never,
  ...over,
});

describe("el motor de la página", () => {
  it("entrega el documento y nombra cada etapa", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps());
    expect(out.ok).toBe(true);
    expect(out.report.stages.map((s) => s.stage)).toEqual([
      "imagery", "legibility", "measure", "invariants", "gate", "modules",
    ]);
  });

  it("aplica los invariantes: la página sin <h1> sale con uno", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps());
    expect(out.ok && out.html).toContain("<h1>Hola</h1>");
  });

  // El motivo por el que existe: crear no tiene página que perder, editar sí.
  it.each([
    ["create", "warn"],
    ["edit", "block"],
  ] as const)("en %s la puerta corre con behaviors=%s", async (mode, behaviors) => {
    gateOk.mockClear();
    await preparePage(PAGE, { mode }, deps());
    expect(gateOk.mock.calls[0]?.[2]).toMatchObject({ behaviors });
  });

  describe("NEVER-THROW — ninguna etapa cosmética puede costar la página", () => {
    it("un Chrome caído no impide entregar", async () => {
      const out = await preparePage(PAGE, { mode: "create" }, deps({
        render: (async () => { throw new Error("chrome muerto"); }) as never,
      }));
      expect(out.ok).toBe(true);
      // Y NO se reporta como "sin roturas": no haber medido es su propio estado.
      expect(out.report.stages.find((s) => s.stage === "measure")?.status).toBe("unavailable");
    });

    it("la búsqueda de fotos caída no impide entregar", async () => {
      const out = await preparePage(PAGE, { mode: "create", brief: "taller de barro" }, deps({
        photograph: (async () => { throw new Error("sin red"); }) as never,
      }));
      expect(out.ok).toBe(true);
      expect(out.report.stages.find((s) => s.stage === "imagery")?.status).toBe("unavailable");
    });
  });

  it("la rotura medida se informa, no se actúa — regenerar es del llamador", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps({
      render: (async () => ({ mobileOverflow: true, invalidGeometry: false })) as never,
    }));
    expect(out.ok).toBe(true);
    expect(out.report.breakage.length).toBeGreaterThan(0);
  });

  it("sólo la puerta puede refusar, y devuelve el motivo", async () => {
    const out = await preparePage(PAGE, { mode: "edit" }, deps({
      gate: (async () => ({ ok: false as const, code: "reserved_marker" })) as never,
    }));
    expect(out.ok).toBe(false);
    expect(!out.ok && out.code).toBe("reserved_marker");
    // El informe sobrevive al rechazo: sin él nadie sabe qué llegó a correr.
    expect(out.report.stages.length).toBeGreaterThan(1);
  });

  it("sin brief no se buscan fotos", async () => {
    const photograph = vi.fn();
    await preparePage(PAGE, { mode: "edit" }, deps({ photograph: photograph as never }));
    expect(photograph).not.toHaveBeenCalled();
  });
});

describe("una edición no paga por lo que ya estaba roto", () => {
  // El caso real: la primera página que generó el motor traía botones de filtro
  // sin su rejilla. Crear la entrega (falla abierto); editar la rechazaba
  // (falla cerrado), así que esa página no se podía cambiar NUNCA.
  const conDefecto = `<!doctype html><html><head></head><body><div data-ol-filter-group="panes"><button data-ol-filter="a">A</button></div></body></html>`;

  it("sin priorHtml, el defecto heredado bloquea — la trampa que había", async () => {
    const out = await preparePage(conDefecto, { mode: "edit", renderChecks: false });
    expect(out.ok).toBe(false);
  });

  it("con priorHtml, el defecto heredado NO bloquea", async () => {
    const editada = conDefecto.replace("<button", "<p>texto nuevo</p><button");
    const out = await preparePage(editada, {
      mode: "edit",
      renderChecks: false,
      priorHtml: conDefecto,
    });
    expect(out.ok).toBe(true);
  });

  it("pero un defecto que ESTA edición introduce sí bloquea", async () => {
    const sano = `<!doctype html><html><head></head><body><p>hola</p></body></html>`;
    const out = await preparePage(conDefecto, {
      mode: "edit",
      renderChecks: false,
      priorHtml: sano,
    });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.report.behaviorIssues?.length).toBe(1);
  });
});

// L2 — la compilación de los cálculos vive DENTRO de `beforeMeta`, junto a los
// invariantes, y no en el llamador: así el documento que la puerta valida es el
// ya compilado, y las tres superficies (crear, Chat, Agente) lo heredan sin que
// ninguna lo cablee por su cuenta.
describe("los cálculos se compilan al ingerir", () => {
  const CALC = `<!doctype html><html><body><div data-ol-calc>` +
    `<input data-ol-val="recibo" type="number" value="1800">` +
    `<p data-ol-out="REDONDEA(recibo * 0.72, 0)">0</p>` +
    `</div></body></html>`;

  it("el gemelo compilado y el valor de nacimiento salen del motor", async () => {
    const out = await preparePage(CALC, { mode: "create" }, deps());
    expect(out.ok).toBe(true);
    expect(out.ok && out.html).toContain("data-ol-out-c=");
    // Nace con el número visible: sin esto, una página sin JS mostraría un hueco.
    expect(out.ok && out.html).toContain(">1296<");
  });

  it("el informe dice cuántas regiones compiló", async () => {
    const out = await preparePage(CALC, { mode: "create" }, deps());
    const inv = out.report.stages.find((s) => s.stage === "invariants");
    expect(inv?.detail).toContain("calc=1/1");
  });

  it("una página sin cálculos no paga nada", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps());
    const inv = out.report.stages.find((s) => s.stage === "invariants");
    expect(inv?.detail).toContain("calc=0/0");
    expect(out.ok && out.html).not.toContain("-c=");
  });
});
