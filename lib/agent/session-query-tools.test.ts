// LAS HERRAMIENTAS DE BUSCAR EN CHARLAS PASADAS (pieza 5): el plazo de DeepSeek.
// Una búsqueda que no vuelve no puede colgar el turno: a los 30 s
// (`DEFAULT_SEARCH_TIMEOUT_MS` de tool-session-query) se le dice al modelo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SEARCH_TIMEOUT_MS, toolSessionEventSearch, toolSessionSearch } from "./session-query-tools";
import type { AgentDeps, AgentSession } from "./tools";

const session = { projectId: "p1", userId: "u1" } as AgentSession;
const colgada = { chatRows: () => new Promise<never>(() => undefined) } as unknown as AgentDeps;

afterEach(() => vi.useRealTimers());

describe("el plazo de las búsquedas", () => {
  it("es el de DeepSeek", () => {
    expect(DEFAULT_SEARCH_TIMEOUT_MS).toBe(30_000);
  });

  it("🔴 una búsqueda que no vuelve se corta a los 30 s con un error para el modelo", async () => {
    vi.useFakeTimers();
    const p = toolSessionSearch(session, colgada, { query: "horario" });
    await vi.advanceTimersByTimeAsync(DEFAULT_SEARCH_TIMEOUT_MS);
    const out = await p;
    expect(out.response.ok).toBe(false);
    expect(String(out.response.error)).toMatch(/timed out/);
  });

  it("también la de dentro de una charla", async () => {
    vi.useFakeTimers();
    const p = toolSessionEventSearch(session, colgada, { query: "horario" });
    await vi.advanceTimersByTimeAsync(DEFAULT_SEARCH_TIMEOUT_MS);
    expect((await p).response.ok).toBe(false);
  });
});
