// «Quitar esta tarea» from the email (spec local 2026-10-29-tareas-programadas, §7.8): only a POST with
// the signed token removes; opening the link (a GET, which mail scanners do on their own) never does.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/scheduled-tasks/store", () => ({ getTaskById: vi.fn(), deleteTask: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));

import { removalToken } from "@/lib/scheduled-tasks/removal-token";
import { deleteTask, getTaskById } from "@/lib/scheduled-tasks/store";
import RemovePage from "@/app/[locale]/scheduled-tasks/remove/page";
import { POST } from "./route";

const env = { AUTH_SECRET: "s3cret" };
const post = (body: unknown) => POST(new Request("http://x/api/scheduled-tasks/remove", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", env.AUTH_SECRET);
  vi.mocked(getTaskById).mockResolvedValue({ id: "schedule-1", projectId: "p1", record: { title: "PDF de resultados" } } as never);
  vi.mocked(deleteTask).mockResolvedValue(true);
});

describe("POST /api/scheduled-tasks/remove", () => {
  it("a wrong token removes nothing", async () => {
    expect((await post({ task: "schedule-1", token: "0".repeat(24) })).status).toBe(403);
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("the signed token removes that task", async () => {
    const res = await post({ task: "schedule-1", token: removalToken("schedule-1", env) });
    expect(res.status).toBe(200);
    expect(deleteTask).toHaveBeenCalledWith("p1", "schedule-1");
  });
});

describe("the confirmation page", () => {
  it("opening the link shows the question and removes nothing", async () => {
    const page = await RemovePage({ params: Promise.resolve({ locale: "es" }), searchParams: Promise.resolve({ task: "schedule-1", token: removalToken("schedule-1", env)! }) });
    expect(page).toBeTruthy();
    expect(deleteTask).not.toHaveBeenCalled();
  });
});
