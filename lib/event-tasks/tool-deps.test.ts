import { describe, expect, it, vi } from "vitest";

const validate = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("./sources", () => ({ sourceOf: () => ({ validate }) }));
vi.mock("./cards", () => ({ latestCards: vi.fn() }));
vi.mock("./store", () => ({ createEventTask: vi.fn(), deleteEventTask: vi.fn(), getEventTask: vi.fn(), listEventTasks: vi.fn(), updateEventTask: vi.fn() }));

const { SourceError } = await import("./sources/types");
const { eventTasksToolDeps } = await import("./tool-deps");

describe("eventTasksToolDeps.validate", () => {
  it("answers a source's own failure as its reason", async () => {
    validate.mockRejectedValueOnce(new SourceError("no_live", "The app has no production base yet."));
    await expect(eventTasksToolDeps.validate("app_rows", "p1", { table: "reservas" })).resolves.toEqual({ ok: false, reason: "The app has no production base yet." });
  });

  it("lets any other failure through", async () => {
    validate.mockRejectedValueOnce(new Error("connection refused"));
    await expect(eventTasksToolDeps.validate("app_rows", "p1", { table: "reservas" })).rejects.toThrow("connection refused");
  });
});
