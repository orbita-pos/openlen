// Hallazgo 5 — «Undo confirma éxito antes de saber si restauró y no modela
// turnos multipágina». Las dos mitades, cada una con su contra-prueba para que
// un arreglo demasiado ancho (por ejemplo: esconder Deshacer siempre que el
// turno traiga `paginasTocadas`) no pueda pasar.
import { describe, expect, it, vi } from "vitest";
import {
  ejecutarUndo,
  planDeUndo,
  type DepsDeUndo,
  type FalloDeUndo,
} from "./undo-turn";

function espias() {
  const pintado: Array<{ html: string; page: string | null }> = [];
  const fallos: FalloDeUndo[] = [];
  let revertido = 0;
  const deps: Omit<DepsDeUndo, "fetchImpl"> = {
    projectId: "p1",
    pintar: (html, page) => void pintado.push({ html, page }),
    marcarRevertido: () => void (revertido += 1),
    marcarFallo: (f) => void fallos.push(f),
  };
  return {
    deps,
    pintado,
    fallos,
    get revertido() {
      return revertido;
    },
  };
}

const respuesta = (status: number) =>
  new Response(JSON.stringify({ ok: status < 400 }), { status });

describe("planDeUndo", () => {
  it("ancla la restauración a la página en la que empezó el turno", () => {
    const plan = planDeUndo(
      { status: "applied", preEditHtml: "<html>antes</html>", page: "menu" },
      // El lienzo ya está en otra página: da igual, la preimagen es de /menu.
      null,
    );
    expect(plan).toEqual({
      kind: "restaurar",
      page: "menu",
      html: "<html>antes</html>",
    });
  });

  it("un turno pre-multipágina (sin `page`) cae a la página actual", () => {
    const plan = planDeUndo(
      { status: "applied", preEditHtml: "<html>antes</html>" },
      "servicios",
    );
    expect(plan).toEqual({
      kind: "restaurar",
      page: "servicios",
      html: "<html>antes</html>",
    });
  });

  it("sin preimagen no hay Deshacer (turno restaurado de otra sesión)", () => {
    const plan = planDeUndo({ status: "applied", preEditHtml: "" }, null);
    expect(plan).toEqual({ kind: "imposible", motivo: "sin-preimagen" });
  });

  it("un turno que no está aplicado no se puede deshacer", () => {
    const plan = planDeUndo(
      { status: "reverted", preEditHtml: "<html>antes</html>", page: null },
      null,
    );
    expect(plan).toEqual({ kind: "imposible", motivo: "no-aplicado" });
  });

  // ── La segunda mitad del hallazgo ────────────────────────────────────────
  it("un turno Home → trabajar_en_pagina(menu) → editar NO ofrece Deshacer", () => {
    // La preimagen es la de Home; lo que cambió fue /menu. Restaurar Home sería
    // un no-op y cantar «Revertido» sobre /menu, una mentira.
    const plan = planDeUndo(
      {
        status: "applied",
        preEditHtml: "<html>home antes</html>",
        page: null,
        paginasTocadas: ["menu"],
      },
      null,
    );
    expect(plan).toEqual({ kind: "imposible", motivo: "otra-pagina" });
  });

  it("tampoco cuando tocó la suya Y otra", () => {
    const plan = planDeUndo(
      {
        status: "applied",
        preEditHtml: "<html>home antes</html>",
        page: null,
        paginasTocadas: [null, "menu"],
      },
      null,
    );
    expect(plan).toEqual({ kind: "imposible", motivo: "otra-pagina" });
  });

  // ── Contra-pruebas: el arreglo NO puede matar el Deshacer normal ─────────
  it("CONTRA-PRUEBA: un turno del Agente en una sola página SÍ se deshace", () => {
    const plan = planDeUndo(
      {
        status: "applied",
        preEditHtml: "<html>antes</html>",
        page: "menu",
        // Dos eventos `html` (dos ops seguidas) sobre la MISMA página.
        paginasTocadas: ["menu", "menu"],
      },
      null,
    );
    expect(plan).toEqual({
      kind: "restaurar",
      page: "menu",
      html: "<html>antes</html>",
    });
  });

  it("CONTRA-PRUEBA: null y undefined son la misma Home, no dos páginas", () => {
    const plan = planDeUndo(
      {
        status: "applied",
        preEditHtml: "<html>antes</html>",
        page: null,
        paginasTocadas: [null],
      },
      null,
    );
    expect(plan.kind).toBe("restaurar");
  });
});

describe("ejecutarUndo", () => {
  it("un PATCH 500 NO pinta, NO dice revertido, y lo cuenta", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => respuesta(500));
    const ok = await ejecutarUndo(
      { kind: "restaurar", page: null, html: "<html>antes</html>" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(false);
    expect(e.pintado).toEqual([]);
    expect(e.revertido).toBe(0);
    expect(e.fallos).toEqual([{ motivo: "http", status: 500 }]);
  });

  it("un 413 llega con su código (el usuario tiene que saber que es tamaño)", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => respuesta(413));
    await ejecutarUndo(
      { kind: "restaurar", page: null, html: "x".repeat(32) },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(e.fallos).toEqual([{ motivo: "http", status: 413 }]);
    expect(e.revertido).toBe(0);
  });

  it("un fetch que revienta tampoco dice revertido", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const ok = await ejecutarUndo(
      { kind: "restaurar", page: "menu", html: "<html>antes</html>" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(false);
    expect(e.pintado).toEqual([]);
    expect(e.revertido).toBe(0);
    expect(e.fallos).toEqual([{ motivo: "red" }]);
  });

  // ── Contra-prueba: el camino bueno sigue funcionando entero ──────────────
  it("CONTRA-PRUEBA: con 200 pinta la preimagen en su página y revierte", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => respuesta(200));
    const ok = await ejecutarUndo(
      { kind: "restaurar", page: "menu", html: "<html>antes</html>" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(true);
    expect(e.pintado).toEqual([{ html: "<html>antes</html>", page: "menu" }]);
    expect(e.revertido).toBe(1);
    expect(e.fallos).toEqual([]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/projects/p1/html");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      html: "<html>antes</html>",
      page: "menu",
    });
  });

  it("la Home viaja SIN campo `page` (el servidor 404 si le mandas uno vacío)", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => respuesta(200));
    await ejecutarUndo(
      { kind: "restaurar", page: null, html: "<html>home</html>" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ html: "<html>home</html>" });
  });

  it("un plan imposible no toca la red", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => respuesta(200));
    const ok = await ejecutarUndo(
      { kind: "imposible", motivo: "otra-pagina" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(e.revertido).toBe(0);
  });
});
