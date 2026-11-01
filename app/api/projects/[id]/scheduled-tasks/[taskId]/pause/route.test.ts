// Pausing and resuming a scheduled task from the web clock or the phone (spec local
// 2026-10-31-len-movil, §5.5): owner and editors only, recurring tasks only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/scheduled-tasks/enabled", () => ({ scheduleEnabled: vi.fn(() => true) }));
vi.mock("@/lib/scheduled-tasks/store", () => ({ pauseTask: vi.fn(), resumeTask: vi.fn() }));

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { scheduleEnabled } from "@/lib/scheduled-tasks/enabled";
import { pauseTask, resumeTask } from "@/lib/scheduled-tasks/store";
import type { TaskRow } from "@/lib/scheduled-tasks/store";
import { OPTIONS, POST } from "./route";

const ctx = { params: Promise.resolve({ id: "p1", taskId: "t1" }) };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scheduleEnabled).mockReturnValue(true);
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("ana");
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" });
  vi.mocked(pauseTask).mockResolvedValue({ id: "t1", pausedAt: new Date() } as TaskRow);
  vi.mocked(resumeTask).mockResolvedValue({ id: "t1", pausedAt: null } as TaskRow);
});

describe("POST /api/projects/[id]/scheduled-tasks/[taskId]/pause", () => {
  it("an editor pauses a task", async () => {
    const res = await post({ paused: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", paused: true });
    expect(pauseTask).toHaveBeenCalledWith("p1", "t1", expect.any(Date));
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "ana", "editar");
  });

  it("resumes a task", async () => {
    const res = await post({ paused: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", paused: false });
    expect(resumeTask).toHaveBeenCalledWith("p1", "t1", expect.any(Date));
  });

  it("a viewer is refused", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue(new Response(null, { status: 403 }));
    expect((await post({ paused: true })).status).toBe(403);
    expect(pauseTask).not.toHaveBeenCalled();
  });

  it("a one-shot task cannot be paused", async () => {
    vi.mocked(pauseTask).mockResolvedValue("one_shot");
    const res = await post({ paused: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "schedule_one_shot" });
  });

  it("an unknown task is 404", async () => {
    vi.mocked(pauseTask).mockResolvedValue("not_found");
    expect((await post({ paused: true })).status).toBe(404);
  });

  it("without a boolean `paused` it is 400", async () => {
    expect((await post({ paused: "yes" })).status).toBe(400);
  });

  it("with scheduled tasks off it is 503", async () => {
    vi.mocked(scheduleEnabled).mockReturnValue(false);
    expect((await post({ paused: true })).status).toBe(503);
  });

  it("without a person it is 401", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue(null);
    expect((await post({ paused: true })).status).toBe(401);
  });

  it("answers the phone app's CORS", async () => {
    const res = await post({ paused: true }, { origin: "https://localhost" });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(typeof OPTIONS).toBe("function");
  });
});
