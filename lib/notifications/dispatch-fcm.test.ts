// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const d = vi.hoisted(() => ({ fcm: vi.fn(), web: vi.fn(), email: vi.fn(), prefs: { webPushEnabled: true, emailEnabled: true, quietFrom: null as string | null, quietUntil: null as string | null, timezone: "UTC" }, updates: [] as Record<string, unknown>[], logs: [] as Record<string, unknown>[] }));
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), db: {
  execute: async () => ({ rows: [{ id: "job", attempts: 1, payload: { type: "len_turno", projectId: "p1", recipientUserId: "ana", preview: "listo", pregunta: false } }] }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [d.prefs] }) }) }),
  update: () => ({ set: (v: Record<string, unknown>) => { d.updates.push(v); return { where: async () => {} }; } }),
  insert: () => ({ values: async (v: Record<string, unknown>) => { d.logs.push(v); } }),
} }));
vi.mock("@/lib/chat/hub", () => ({ hub: {} }));
vi.mock("@/lib/chat/agents", () => ({ listAgentUserIds: vi.fn() }));
vi.mock("@/lib/notifications/channels/index", () => ({ CHANNELS: [{ id: "fcm", send: d.fcm }, { id: "webpush", send: d.web }, { id: "email", send: d.email }] }));
import { runJob } from "./dispatch";
beforeEach(() => { vi.resetAllMocks(); d.updates.length = 0; d.logs.length = 0; d.prefs.webPushEnabled = true; d.prefs.quietFrom = null; d.prefs.quietUntil = null; d.web.mockResolvedValue("skipped"); d.email.mockResolvedValue("skipped"); d.fcm.mockResolvedValue("sent"); });
describe("avisos nativos en la cola duradera", () => {
  it("FCM entrega el turno y evita un segundo aviso por correo", async () => {
    await runJob("job");
    expect(d.logs).toContainEqual(expect.objectContaining({ channel: "fcm", status: "sent" }));
    expect(d.logs).toContainEqual(expect.objectContaining({ channel: "email", status: "skipped", detail: "push succeeded" }));
    expect(d.updates.at(-1)).toMatchObject({ status: "done" });
  });
  it("reintenta errores de FCM cuando ningún canal entregó", async () => {
    d.fcm.mockRejectedValue(new Error("FCM 503"));
    await runJob("job");
    expect(d.updates.at(-1)).toMatchObject({ status: "pending", lastError: "FCM 503" });
  });
  it("el silencio posterga TODOS los canales", async () => {
    d.prefs.quietFrom = "00:00"; d.prefs.quietUntil = "23:59";
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    try { await runJob("job"); expect(d.logs).toEqual([]); expect(d.updates.at(-1)).toMatchObject({ attempts: 0 }); } finally { vi.useRealTimers(); }
  });
  it("la preferencia push desactivada bloquea FCM", async () => {
    d.prefs.webPushEnabled = false;
    await runJob("job");
    expect(d.logs.some(l => l.channel === "fcm")).toBe(false);
  });
});
