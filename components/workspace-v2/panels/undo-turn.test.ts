// Hallazgo 5 — «Undo confirma éxito antes de saber si restauró y no modela
// turnos multipágina». Las dos mitades, cada una con su contra-prueba para que
// un arreglo demasiado ancho (por ejemplo: esconder Deshacer siempre que el
// turno traiga `paginasTocadas`) no pueda pasar.
//
// Y desde el 2026-09-04, la tercera: DESHACER LE ROMPÍA EL JAVASCRIPT A LA
// PÁGINA. El bloque del final lo sujeta con el saneador y el empalme REALES —
// ver su propia cabecera.
import { describe, expect, it, vi } from "vitest";
import { sanitizeForPublish } from "@/lib/html-engine";
import { conservarScripts } from "@/lib/page-engine/conservar-scripts";
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

/** Lo que contesta `POST /versions/<vid>/restore`: el documento restaurado y el
 *  ámbito en el que aterrizó (`restoreVersion`, lib/projects/versions.ts). */
const restaurado = (html: string, page: string | null = null, status = 200) =>
  new Response(JSON.stringify({ html, page, label: "Before AI edit", updatedAt: new Date().toISOString() }), {
    status,
  });

const error = (status: number) =>
  new Response(JSON.stringify({ error: "nope" }), { status });

describe("planDeUndo", () => {
  it("ancla la restauración a la página en la que empezó el turno", () => {
    const plan = planDeUndo(
      {
        status: "applied",
        preEditHtml: "<html>antes</html>",
        versionPrevia: "v1",
        page: "menu",
      },
      // El lienzo ya está en otra página: da igual, la preimagen es de /menu.
      null,
    );
    expect(plan).toEqual({ kind: "restaurar", page: "menu", versionId: "v1" });
  });

  it("un turno pre-multipágina (sin `page`) cae a la página actual", () => {
    const plan = planDeUndo(
      { status: "applied", preEditHtml: "<html>antes</html>", versionPrevia: "v1" },
      "servicios",
    );
    expect(plan).toEqual({ kind: "restaurar", page: "servicios", versionId: "v1" });
  });

  it("sin preimagen no hay Deshacer (turno restaurado de otra sesión)", () => {
    const plan = planDeUndo({ status: "applied", preEditHtml: "", versionPrevia: "v1" }, null);
    expect(plan).toEqual({ kind: "imposible", motivo: "sin-preimagen" });
  });

  // LA COMPATIBILIDAD, dicha en voz alta. Un turno enviado ANTES del
  // 2026-09-04 no trae id de versión: no hay nada del servidor a lo que volver,
  // y el único camino que quedaba —mandar el documento por PATCH /html— es
  // justo el que rompía el JavaScript. No se ofrece Deshacer, que es la regla 2
  // que la cabecera de undo-turn.ts ya declaraba. Las revisiones siguen
  // alcanzables desde la pestaña Versiones.
  it("un turno SIN id de versión (anterior al cambio) no ofrece Deshacer", () => {
    const plan = planDeUndo({ status: "applied", preEditHtml: "<html>antes</html>" }, null);
    expect(plan).toEqual({ kind: "imposible", motivo: "sin-version" });
  });

  it("tampoco cuando el servidor no llegó a archivar nada (`null`)", () => {
    const plan = planDeUndo(
      { status: "applied", preEditHtml: "<html>antes</html>", versionPrevia: null },
      null,
    );
    expect(plan).toEqual({ kind: "imposible", motivo: "sin-version" });
  });

  it("un turno que no está aplicado no se puede deshacer", () => {
    const plan = planDeUndo(
      {
        status: "reverted",
        preEditHtml: "<html>antes</html>",
        versionPrevia: "v1",
        page: null,
      },
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
        versionPrevia: "v1",
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
        versionPrevia: "v1",
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
        versionPrevia: "v1",
        page: "menu",
        // Dos eventos `html` (dos ops seguidas) sobre la MISMA página.
        paginasTocadas: ["menu", "menu"],
      },
      null,
    );
    expect(plan).toEqual({ kind: "restaurar", page: "menu", versionId: "v1" });
  });

  it("CONTRA-PRUEBA: null y undefined son la misma Home, no dos páginas", () => {
    const plan = planDeUndo(
      {
        status: "applied",
        preEditHtml: "<html>antes</html>",
        versionPrevia: "v1",
        page: null,
        paginasTocadas: [null],
      },
      null,
    );
    expect(plan.kind).toBe("restaurar");
  });
});

describe("ejecutarUndo", () => {
  it("un 500 NO pinta, NO dice revertido, y lo cuenta", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => error(500));
    const ok = await ejecutarUndo(
      { kind: "restaurar", page: null, versionId: "v1" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(false);
    expect(e.pintado).toEqual([]);
    expect(e.revertido).toBe(0);
    expect(e.fallos).toEqual([{ motivo: "http", status: 500 }]);
  });

  // La versión pudo caer del historial (`VERSION_LIMIT` desaloja las más
  // viejas). El 404 se dice; no se inventa una restauración.
  it("un 404 llega con su código (la versión ya no está)", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => error(404));
    await ejecutarUndo(
      { kind: "restaurar", page: null, versionId: "v-desalojada" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(e.fallos).toEqual([{ motivo: "http", status: 404 }]);
    expect(e.revertido).toBe(0);
  });

  it("un fetch que revienta tampoco dice revertido", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const ok = await ejecutarUndo(
      { kind: "restaurar", page: "menu", versionId: "v1" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(false);
    expect(e.pintado).toEqual([]);
    expect(e.revertido).toBe(0);
    expect(e.fallos).toEqual([{ motivo: "red" }]);
  });

  // UN 200 SIN DOCUMENTO NO ES UN ÉXITO. Se pinta lo que el servidor devuelve,
  // así que sin documento no hay nada que pintar — y decir «Revertido» sobre
  // eso es afirmar algo que nadie miró. Se cuenta como fallo con su propio
  // motivo, porque no es ni la red ni un código HTTP.
  it("un 200 sin html no dice revertido: se cuenta como respuesta inservible", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await ejecutarUndo(
      { kind: "restaurar", page: null, versionId: "v1" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(false);
    expect(e.pintado).toEqual([]);
    expect(e.revertido).toBe(0);
    expect(e.fallos).toEqual([{ motivo: "respuesta" }]);
  });

  it("un cuerpo que no es JSON tampoco cuela", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => new Response("<html>vaya</html>", { status: 200 }));
    const ok = await ejecutarUndo(
      { kind: "restaurar", page: null, versionId: "v1" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(false);
    expect(e.fallos).toEqual([{ motivo: "respuesta" }]);
  });

  // ── Contra-prueba: el camino bueno sigue funcionando entero ──────────────
  it("CONTRA-PRUEBA: con 200 pinta lo que devolvió el servidor y revierte", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => restaurado("<html>antes</html>", "menu"));
    const ok = await ejecutarUndo(
      { kind: "restaurar", page: "menu", versionId: "v1" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(true);
    expect(e.pintado).toEqual([{ html: "<html>antes</html>", page: "menu" }]);
    expect(e.revertido).toBe(1);
    expect(e.fallos).toEqual([]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/p1/versions/v1/restore");
    expect(init.method).toBe("POST");
  });

  // EL DOCUMENTO NO VIAJA EN LA PETICIÓN, y eso es la mitad del arreglo: el
  // servidor lee la versión de su propia base. Un cuerpo con html volvería a
  // pasar por el saneador y a perder el JavaScript del modelo.
  it("la petición NO lleva el documento", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => restaurado("<html>antes</html>"));
    await ejecutarUndo(
      { kind: "restaurar", page: null, versionId: "v1" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body ?? null).toBeNull();
  });

  // El ÁMBITO lo dice el servidor, no el cliente: la fila de versión lleva su
  // propia `page` y es la que manda dónde aterrizó de verdad.
  it("pinta en la página que dice el servidor", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => restaurado("<html>menu</html>", "menu"));
    await ejecutarUndo(
      { kind: "restaurar", page: "menu", versionId: "v1" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(e.pintado).toEqual([{ html: "<html>menu</html>", page: "menu" }]);
  });

  it("un plan imposible no toca la red", async () => {
    const e = espias();
    const fetchImpl = vi.fn(async () => restaurado("<html>x</html>"));
    const ok = await ejecutarUndo(
      { kind: "imposible", motivo: "otra-pagina" },
      { ...e.deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(e.revertido).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DESHACER LE ROMPÍA EL JAVASCRIPT A LA PÁGINA — 2026-09-04.
//
// Deshacer mandaba el documento entero por `PATCH /api/projects/[id]/html`, y
// ese camino SANEA (borra los `<script>` del modelo) y luego los repone con
// `conservarScripts(guardado, saneado)` — DESDE EL DOCUMENTO GUARDADO.
//
// Para una edición eso es correcto: el cuerpo viene del DOM del navegador y la
// verdad está en la base. Para un DESHACER está al revés —el cuerpo ES la
// verdad— así que repone justo lo que había que tirar:
//
//   · el turno AÑADIÓ JavaScript → vuelve el marcado y el JS del turno SE
//     QUEDA, cableado a elementos que ya no existen;
//   · el turno QUITÓ JavaScript → vuelve el marcado y el JS de antes NO VUELVE.
//     Eso destruye trabajo del usuario, y es el caso que se veía.
//
// EL SERVIDOR ES DE VERDAD. Estas dos pruebas montan las DOS rutas con el
// saneador nativo y el empalme REALES, no con dobles: la trampa que mordió
// cinco veces en la sesión anterior fue creerse suites verdes sobre fixtures
// que no se parecían a producción. Por eso el documento lleva el `<script>` del
// CDN de Tailwind, que el contrato obliga en toda página — sin él,
// `conservarScripts` se comporta distinto (ese bloque sobrevive al saneador y
// es el que le enseña a no duplicar).
//
// Lo que se mide es lo que queda GUARDADO, no lo que se pinta: el lienzo
// enseñaba la preimagen correcta en los dos casos, y por eso el fallo era
// invisible hasta recargar.
// ─────────────────────────────────────────────────────────────────────────────
const TAILWIND = `<script src="https://cdn.tailwindcss.com"></script>`;
const DEL_MODELO = `<script>document.getElementById('reloj').textContent='24:30';</script>`;

const doc = (cuerpo: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reloj</title>${TAILWIND}</head><body><div id="reloj"></div>${cuerpo}</body></html>`;

const CON_JS = doc(DEL_MODELO);
const SIN_JS = doc("");

/** El JavaScript del modelo, el único que cuenta: el CDN de Tailwind no lo es. */
function tieneJsDelModelo(html: string): boolean {
  return html.includes("getElementById('reloj')");
}

/**
 * Las DOS rutas del servidor, con la lógica real de cada una.
 *
 * `guardado` es la base: lo que quedaría en `projects.data.html` después de la
 * petición, que es lo que el usuario se encuentra al recargar.
 */
function servidor(inicial: string, versiones: Record<string, string>) {
  const estado = { guardado: inicial };
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const restore = /\/versions\/([^/]+)\/restore$/.exec(url);
    if (restore) {
      // POST /versions/<vid>/restore — `restoreVersion` lee el HTML de
      // `projectVersions.html` y lo escribe tal cual. NO pasa por el saneador.
      const html = versiones[restore[1]];
      if (html === undefined) return error(404);
      estado.guardado = html;
      return restaurado(html, null);
    }
    if (url.endsWith("/html")) {
      // PATCH /html — el camino viejo, con sus dos pasos REALES.
      const cuerpo = JSON.parse(String(init?.body ?? "{}")) as { html?: string };
      const saneado = sanitizeForPublish(cuerpo.html ?? "");
      if (saneado.html === null) return error(400);
      estado.guardado = conservarScripts(estado.guardado, saneado.html);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return error(404);
  });
  return { estado, fetchImpl };
}

describe("deshacer y el JavaScript del modelo", () => {
  // EL CASO MÍNIMO del encargo, y el que destruía trabajo.
  it("un turno que QUITÓ el JavaScript: al deshacer, el JS de antes VUELVE", async () => {
    const e = espias();
    // La página tenía JS; el turno lo quitó y eso es lo que hay guardado.
    const s = servidor(SIN_JS, { "v-antes": CON_JS });

    const plan = planDeUndo(
      { status: "applied", preEditHtml: CON_JS, versionPrevia: "v-antes", page: null },
      null,
    );
    const ok = await ejecutarUndo(plan, {
      ...e.deps,
      fetchImpl: s.fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(true);
    expect(
      tieneJsDelModelo(s.estado.guardado),
      "el JavaScript de antes del turno no volvió a la base: deshacer destruyó trabajo del usuario",
    ).toBe(true);
    // Y el lienzo enseña lo mismo que quedó guardado, no una copia del cliente.
    expect(e.pintado).toEqual([{ html: CON_JS, page: null }]);
  });

  // El otro lado del mismo defecto: reponer desde el guardado dejaba el script
  // del turno vivo sobre un marcado que ya no lo tiene.
  it("un turno que AÑADIÓ JavaScript: al deshacer, el JS del turno SE VA", async () => {
    const e = espias();
    // La página no tenía JS; el turno se lo puso.
    const s = servidor(CON_JS, { "v-antes": SIN_JS });

    const plan = planDeUndo(
      { status: "applied", preEditHtml: SIN_JS, versionPrevia: "v-antes", page: null },
      null,
    );
    const ok = await ejecutarUndo(plan, {
      ...e.deps,
      fetchImpl: s.fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(true);
    expect(
      tieneJsDelModelo(s.estado.guardado),
      "el JavaScript que el turno añadió sobrevivió al Deshacer, cableado a elementos que ya no existen",
    ).toBe(false);
  });

  // CONTRA-PRUEBA del montaje: si el mismo servidor recibe el camino VIEJO, el
  // JavaScript se pierde. Sin esto, las dos de arriba podrían estar verdes
  // porque el doble del servidor es blando, no porque el arreglo funcione.
  it("CONTRA-PRUEBA: el camino viejo (PATCH /html) SÍ pierde el JavaScript", async () => {
    const s = servidor(SIN_JS, { "v-antes": CON_JS });
    await s.fetchImpl("/api/projects/p1/html", {
      method: "PATCH",
      body: JSON.stringify({ html: CON_JS }),
    });
    expect(tieneJsDelModelo(s.estado.guardado)).toBe(false);
    // El CDN de Tailwind sobrevive: lo que se pierde es el código del modelo.
    expect(s.estado.guardado).toContain("cdn.tailwindcss.com");
  });
});
