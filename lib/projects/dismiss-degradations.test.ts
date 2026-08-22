// dismissDegradations writes into the `data` JSON blob, which is where the
// page itself lives. A careless `set({ data: { degradationsDismissed: true } })`
// would silently destroy html, pages and settings — the whole project — to
// hide a notice. This pins that it merges.
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

import { dismissDegradations } from "@/lib/projects";

const FULL_DATA = {
  html: "<!doctype html><html><body>la página</body></html>",
  pages: { tienda: { html: "<html>tienda</html>" } },
  settings: { whatsapp: { number: "521" } },
  degradations: [{ surface: "from-html", stage: "sanitize", code: "scripts", count: 2 }],
};

describe("dismissDegradations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returning.mockResolvedValue([{ id: "p1" }]);
    mocks.where.mockReturnValue({ returning: mocks.returning });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ data: FULL_DATA }] }) }),
    });
  });

  it("sets the flag without touching the rest of the project", async () => {
    const ok = await dismissDegradations("p1", "u1");

    expect(ok).toBe(true);
    const written = (mocks.set.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(written.html).toBe(FULL_DATA.html);
    expect(written.pages).toEqual(FULL_DATA.pages);
    expect(written.settings).toEqual(FULL_DATA.settings);
    expect(written.degradationsDismissed).toBe(true);
  });

  it("keeps the record itself — only the telling is dismissed", async () => {
    await dismissDegradations("p1", "u1");

    const written = (mocks.set.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    // The row stays diagnosable after the user closes the notice.
    expect(written.degradations).toEqual(FULL_DATA.degradations);
  });

  it("returns false for a project that is not yours", async () => {
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });

    expect(await dismissDegradations("p1", "someone-else")).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
