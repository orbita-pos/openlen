// BUSCAR EN LAS CHARLAS DEL PROYECTO (pieza 5 de Len 2.5), con la forma de
// session-query de DeepSeek: sesión = una charla; cada turno, dos eventos.
import { describe, expect, it } from "vitest";
import {
  CURRENT_SESSION,
  SessionQueryInputError,
  eventSearch,
  findEvent,
  formatEventRead,
  sessionSearch,
  sessionsFromRows,
  type ChatRowForSearch,
} from "./session-query";
import { goalRoundPrompt } from "./goal";

const fila = (o: Partial<ChatRowForSearch> & { id: string; at: string }): ChatRowForSearch => ({
  conversation: null,
  userText: "",
  assistantReasoning: "",
  actions: null,
  status: "applied",
  createdAt: new Date(o.at),
  ...o,
});

const filas: ChatRowForSearch[] = [
  // Una charla archivada.
  fila({ id: "a1", conversation: "c-vieja", at: "2026-09-01T10:00:00Z", userText: "Pon el horario de la tienda", assistantReasoning: "Listo: lunes a viernes de 9 a 18." }),
  fila({ id: "a2", conversation: "c-vieja", at: "2026-09-01T10:05:00Z", userText: "Y el descuento del 20% para estudiantes", assistantReasoning: "Puesto el descuento.", actions: [{ tool: "Edit", status: "done", summary: "index.html" }] }),
  // La charla en curso.
  fila({ id: "b1", at: "2026-10-04T09:00:00Z", userText: "Cambia el horario: los sábados también", assistantReasoning: "Hecho, ahora el horario dice sábados de 10 a 14." }),
  // El turno que está corriendo: no es historia todavía.
  fila({ id: "b2", at: "2026-10-05T03:00:00Z", userText: "¿qué horario puse la otra vez?", assistantReasoning: "", status: "en_curso" }),
];

describe("sessionsFromRows", () => {
  it("una sesión por charla (la en curso es `current`), dos eventos por turno y sin el turno que corre", () => {
    const s = sessionsFromRows(filas);
    const vieja = s.find((x) => x.id === "c-vieja")!;
    const actual = s.find((x) => x.id === CURRENT_SESSION)!;
    expect(vieja.title).toBe("Pon el horario de la tienda");
    expect(vieja.events.map((e) => `${e.seq}:${e.type}`)).toEqual(["1:user", "2:assistant", "3:user", "4:assistant"]);
    expect(actual.events).toHaveLength(2);
    expect(actual.events.some((e) => e.rowId === "b2")).toBe(false);
  });

  it("el evento del asistente lleva sus acciones como texto, para que también se encuentren", () => {
    const e = sessionsFromRows(filas).find((x) => x.id === "c-vieja")!.events[3]!;
    expect(e.text).toContain("Puesto el descuento.");
    expect(e.text).toContain("Edit: index.html");
  });
});

describe("sessionSearch", () => {
  const s = sessionsFromRows(filas);

  it("busca texto literal sin mayúsculas en todas las charlas y da la mejor coincidencia de cada una", () => {
    const out = sessionSearch(s, { query: "HORARIO" });
    expect(out).toContain("Session search results (2):");
    expect(out).toContain(`Session ${CURRENT_SESSION} — Cambia el horario: los sábados también`);
    expect(out).toContain("Session c-vieja — Pon el horario de la tienda");
    expect(out).toMatch(/Best match: seq \d+ \| (user|assistant) \| 2026-/);
    expect(out).toMatch(/Snippet: .*horario/i);
  });

  it("🔴 `%` y `_` son literales, no comodines", () => {
    expect(sessionSearch(s, { query: "20%" })).toContain("Session search results (1):");
    expect(sessionSearch(s, { query: "2_%" })).toBe("No prior session matches found.");
  });

  it("filtra por sesión, por fecha de la charla y por tipo de evento", () => {
    expect(sessionSearch(s, { query: "horario", session_ids: ["c-vieja"] })).toContain("Session search results (1):");
    expect(sessionSearch(s, { query: "horario", created_at_from: "2026-10-01T00:00:00Z" })).toContain(`Session ${CURRENT_SESSION}`);
    expect(sessionSearch(s, { query: "horario", created_at_from: "2026-10-01T00:00:00Z" })).not.toContain("c-vieja");
    expect(sessionSearch(s, { query: "lunes", event_types: ["user"] })).toBe("No prior session matches found.");
  });

  it("🔴 el turno que corre no se encuentra a sí mismo", () => {
    expect(sessionSearch(s, { query: "la otra vez" })).toBe("No prior session matches found.");
  });

  it("con el tope, lo dice", () => {
    const muchas = Array.from({ length: 5 }, (_, i) => fila({ id: `m${i}`, conversation: `c${i}`, at: `2026-09-0${i + 1}T10:00:00Z`, userText: "horario" }));
    const out = sessionSearch(sessionsFromRows(muchas), { query: "horario" }, 2);
    expect(out).toContain("Session search results (2):");
    expect(out).toContain("Result cap reached. Narrow the query or add filters to find additional matches.");
  });

  it("🔴 lo que no vale es un error para el modelo, no una excepción cualquiera", () => {
    expect(() => sessionSearch(s, { query: "   " })).toThrow(SessionQueryInputError);
    expect(() => sessionSearch(s, { query: "x", created_at_from: "2026-10-01" })).toThrow(/timezone/);
  });
});

describe("eventSearch y leer un evento", () => {
  const s = sessionsFromRows(filas);

  it("sin session_id busca en la charla en curso; con uno, en esa", () => {
    expect(eventSearch(s, { query: "sábados" })).toContain(`Session ${CURRENT_SESSION}`);
    expect(eventSearch(s, { query: "sábados" })).toContain("Event search results (2):");
    expect(eventSearch(s, { session_id: "c-vieja", query: "descuento" })).toMatch(/1\. seq 3 \| user/);
    expect(eventSearch(s, { session_id: "c-vieja", query: "nada de esto" })).toContain("No prior event matches found.");
  });

  it("una sesión que no existe es un error para el modelo", () => {
    expect(() => eventSearch(s, { session_id: "inventada", query: "x" })).toThrow(SessionQueryInputError);
  });

  it("lee el evento entero con sus vecinos antes y después", () => {
    const hit = findEvent(s, "c-vieja", 3)!;
    const out = formatEventRead(hit.session, hit.event, { actions: [] }, 1, 1);
    expect(out).toContain("Session c-vieja — Pon el horario de la tienda");
    expect(out).toContain("Target event seq 3:");
    expect(out).toContain('"text": "Y el descuento del 20% para estudiantes"');
    expect(out).toContain("Before:\n- seq 2 | assistant |");
    expect(out).toContain("After:\n- seq 4 | assistant |");
    expect(findEvent(s, undefined, 99)).toBeNull();
  });
});

// LOTE 7-8 · las rondas del encargo guardan su mensaje de ronda en `userText`.
// DeepSeek lo crea como un `user/message` de texto (goal-round-driver/src/index.ts)
// y su búsqueda indexa el texto de todo `user/message` sin mirar de dónde viene
// (session-query/src/extraction.ts): se busca ENTERO, objetivo y texto fijo.
describe("las rondas del encargo (lote 7-8), como DeepSeek", () => {
  const ronda = fila({
    id: "r2",
    at: "2026-10-05T12:00:00Z",
    userText: goalRoundPrompt({ objective: "Montar la tienda de pasteles", maxGoalRounds: 256 }, 2),
    assistantReasoning: "Seguí con el carrito.",
  });
  const s = sessionsFromRows([ronda]);

  it("se encuentra por su objetivo", () => {
    expect(sessionSearch(s, { query: "tienda de pasteles" })).toContain("Session search results (1):");
  });

  it("y también por su texto fijo: se indexa entero, como allí", () => {
    expect(sessionSearch(s, { query: "Treat the current project" })).toContain("Best match: seq 1 | user");
  });
});
