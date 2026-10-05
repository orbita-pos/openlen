// LAS TARJETAS DE HERRAMIENTA DEL CHAT (pieza 4): con varias a la vez, cada
// `done` reemplaza SU `running` — la más vieja de esa herramienta, porque el
// servidor las abre y las cierra en el orden del modelo.
import { describe, expect, it } from "vitest";
import { upsertActionInto } from "./action-cards";
import type { AgentAction } from "../agent-action-card";

const a = (tool: string, status: AgentAction["status"], summary: string): AgentAction => ({ tool, status, summary });

describe("upsertActionInto", () => {
  it("en serie, como siempre: el done reemplaza la running de detrás", () => {
    let l = upsertActionInto(undefined, a("Read", "running", "/a"));
    l = upsertActionInto(l, a("Read", "done", "/a"));
    expect(l).toEqual([a("Read", "done", "/a")]);
  });

  it("🔴 dos Read a la vez: se ven las dos en marcha, cada done cierra la suya y no queda ninguna running", () => {
    let l = upsertActionInto(undefined, a("Read", "running", "/a"));
    l = upsertActionInto(l, a("Read", "running", "/b"));
    expect(l).toEqual([a("Read", "running", "/a"), a("Read", "running", "/b")]);
    l = upsertActionInto(l, a("Read", "done", "/a"));
    expect(l).toEqual([a("Read", "done", "/a"), a("Read", "running", "/b")]);
    l = upsertActionInto(l, a("Read", "done", "/b"));
    expect(l).toEqual([a("Read", "done", "/a"), a("Read", "done", "/b")]);
  });

  it("herramientas distintas a la vez: cada una la suya", () => {
    let l = upsertActionInto(undefined, a("Read", "running", "/a"));
    l = upsertActionInto(l, a("web_fetch", "running", "https://x"));
    l = upsertActionInto(l, a("Read", "error", "/a"));
    l = upsertActionInto(l, a("web_fetch", "done", "https://x"));
    expect(l.map((x) => `${x.tool} ${x.status}`)).toEqual(["Read error", "web_fetch done"]);
  });

  it("un done sin running delante (la verificación de los ojos, por ejemplo) se añade", () => {
    const l = upsertActionInto([a("Edit", "done", "/i")], a("verificar_diseno", "done", ""));
    expect(l).toHaveLength(2);
  });

  it("no toca la lista que recibe", () => {
    const antes = [a("Read", "running", "/a")];
    upsertActionInto(antes, a("Read", "done", "/a"));
    expect(antes[0].status).toBe("running");
  });
});
