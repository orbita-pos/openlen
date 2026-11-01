// The phone's «Tareas» (spec local 2026-10-31-len-movil, §5.4): the overview of the person asking.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/movil/tasks-overview", () => ({ buildTasksOverview: vi.fn() }));

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { buildTasksOverview } from "@/lib/movil/tasks-overview";
import { GET } from "./route";

const OVERVIEW = { needsYou: [], working: [], scheduled: [], resolved: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("u1");
  vi.mocked(buildTasksOverview).mockResolvedValue(OVERVIEW);
});

describe("GET /api/movil/tasks", () => {
  it("answers the overview of whoever asks", async () => {
    const res = await GET(new Request("http://x/api/movil/tasks", { headers: { origin: "https://localhost" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OVERVIEW);
    expect(vi.mocked(buildTasksOverview).mock.calls[0]![0]).toBe("u1");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("without a person it is 401", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue(null);
    expect((await GET(new Request("http://x/api/movil/tasks"))).status).toBe(401);
  });
});
