// GET /api/projects/[id]/event-cards (spec local 2026-11-03-len-que-avisa, §7.6; 2026-11-04-hazlo, §8): the owner's
// cards with each action and its state, the note of an «Ahora no», and where the replies come back to.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn(async () => "u1") }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/event-tasks/enabled", () => ({ eventTasksEnabled: () => true }));
vi.mock("@/lib/event-tasks/cards", () => ({ cardsOfProject: vi.fn() }));
vi.mock("@/lib/event-tasks/store", () => ({ listEventTasks: vi.fn(async () => [{ id: "t1", title: "Reservas que chocan" }]) }));
vi.mock("@/lib/db", () => ({
  schema: { users: { id: "id", email: "email" } },
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ email: "dueno@lamesa.mx" }] }) }) }) },
}));

const { exigirAcceso } = await import("@/lib/projects/acceso");
const { cardsOfProject } = await import("@/lib/event-tasks/cards");
const { GET } = await import("./route");

const NOW = new Date("2026-11-04T10:00:00Z");
const reply = { kind: "reply", channel: "email", to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis." };
const get = () => GET(new Request("http://localhost/api/projects/p1/event-cards"), { params: Promise.resolve({ id: "p1" }) });

beforeEach(() => {
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "dueno", duenoId: "u1" } as never);
  vi.mocked(cardsOfProject).mockResolvedValue([
    { id: "c1", taskId: "t1", title: "Choca la mesa 4", summary: "s", proposedAction: "→ luis@ejemplo.com: Tu reserva", status: "dismissed", acceptedRowId: null, createdAt: NOW, dismissNote: "Ofrécele la 8.", subjectKey: "luis@ejemplo.com", actions: [{ action: reply, state: "pending", attempts: 0, nextAttemptAt: null, error: null, result: null }] },
    { id: "c0", taskId: "t1", title: "Antes", summary: "s", proposedAction: "Escribirle a Ana.", status: "accepted", acceptedRowId: "row-1", createdAt: NOW, dismissNote: null, actions: null },
  ] as never);
});

describe("GET event-cards", () => {
  it("each card brings its actions with their states and its note, and the answer where replies come back to", async () => {
    const body = await (await get()).json();
    expect(body.repliesTo).toBe("dueno@lamesa.mx");
    expect(body.cards[0]).toMatchObject({ id: "c1", taskTitle: "Reservas que chocan", dismissNote: "Ofrécele la 8.", subjectKey: "luis@ejemplo.com", actions: [{ action: reply, state: "pending" }] });
    // A card from before the actions has none.
    expect(body.cards[1]).toMatchObject({ id: "c0", actions: null, dismissNote: null });
  });

  it("a member gets no cards", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" } as never);
    expect(await (await get()).json()).toEqual({ cards: [] });
  });
});
