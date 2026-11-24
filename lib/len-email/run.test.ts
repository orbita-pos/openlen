// @vitest-environment node
// LEN POR CORREO: la respuesta se guarda antes de mandarse, y un reinicio no
// deja a nadie sin contestar ni repite un turno que ya corrió.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  log: [] as string[],
  pending: [] as unknown[],
  launched: [] as Record<string, unknown>[],
  failSend: false,
  keys: [] as (string | undefined)[],
  attached: [] as string[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  schema: { projects: { id: "id", title: "title" } },
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ title: "Café Luna" }] }) }) }) },
}));
vi.mock("@/lib/len-email/requests", () => ({
  saveEmailReply: async (id: string, t: string) => void mocks.log.push(`save ${id}: ${t}`),
  markEmailReplied: async (id: string) => void mocks.log.push(`mark ${id}`),
  unansweredEmailRequests: async () => mocks.pending,
}));
vi.mock("@/lib/email", () => ({
  sendLenReplyEmail: async (p: { to: string; texto: string; replyTo: string; idempotencyKey?: string; attachments?: { filename: string }[] }) => {
    mocks.keys.push(p.idempotencyKey);
    mocks.attached.push((p.attachments ?? []).map((a) => a.filename));
    if (mocks.failSend) throw new Error("resend caído");
    mocks.log.push(`send ${p.to}: ${p.texto}`);
  },
}));
// The files Len presented, as the route stores them (`present`): a small one fits, a big one is linked.
vi.mock("@/lib/agent/skills/deliveries", () => ({
  deliveryStore: () => ({ get: async (key: string) => new Uint8Array(key.includes("small") ? 10 : 1) }),
}));
vi.mock("@/lib/agent/turnos-desde-el-servidor", () => ({
  launchEmailTurn: async (p: Record<string, unknown>) => {
    mocks.launched.push(p);
    return { filaId: p.filaId };
  },
}));

const PROJECT = "0b6f4c1e-2a3d-4e5f-8a9b-1c2d3e4f5a6b";
const req = (over: Record<string, unknown> = {}) => ({
  id: "req-1",
  projectId: PROJECT,
  userId: "u-ana",
  sender: "ana@gmail.com",
  subject: "Precios",
  texto: "cambia el precio",
  idioma: "es",
  inReplyTo: "<abc@x>",
  respuesta: null as string | null,
  createdAt: new Date(Date.now() - 60_000),
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("LEN_EMAIL_DOMAIN", "reply.openlen.com");
  vi.stubEnv("NEXTAUTH_SECRET", "s3cr3t");
  mocks.log = [];
  mocks.pending = [];
  mocks.launched = [];
  mocks.failSend = false;
  mocks.keys = [];
  mocks.attached = [];
});

describe("correr un correo apuntado", () => {
  it("🔴 el turno usa el id del correo como fila; lo que Len dice se GUARDA, se manda y se marca, en ese orden", async () => {
    const { startEmailRequest } = await import("./run");
    await startEmailRequest(req());
    expect(mocks.launched[0]).toMatchObject({ userId: "u-ana", projectId: PROJECT, texto: "cambia el precio", filaId: "req-1" });
    await (mocks.launched[0]!.reply as (t: string) => Promise<void>)("Listo.");
    expect(mocks.log).toEqual(["save req-1: Listo.", "send ana@gmail.com: Listo.", "mark req-1"]);
  });

  it("🔴 si el envío falla, la respuesta queda guardada y SIN marcar (el reinicio la reenvía)", async () => {
    const { startEmailRequest } = await import("./run");
    await startEmailRequest(req());
    mocks.failSend = true;
    await expect((mocks.launched[0]!.reply as (t: string) => Promise<void>)("Listo.")).rejects.toThrow();
    expect(mocks.log).toEqual(["save req-1: Listo."]);
  });

  it("🔴 the reply goes with the email's id as its idempotency key, the same one the restart's resend uses", async () => {
    const { startEmailRequest } = await import("./run");
    await startEmailRequest(req());
    mocks.failSend = true;
    await expect((mocks.launched[0]!.reply as (t: string) => Promise<void>)("Listo.")).rejects.toThrow();
    mocks.failSend = false;
    mocks.pending = [{ ...req({ respuesta: "Listo." }), started: true }];
    const { resumeEmailRequests } = await import("./run");
    await resumeEmailRequests();
    expect(mocks.keys).toEqual(["len-email:req-1", "len-email:req-1"]);
  });
});

describe("the files the email came with", () => {
  it("🔴 Len is told what came attached (their bytes never reach him)", async () => {
    const { startEmailRequest } = await import("./run");
    await startEmailRequest(req(), { attachments: [{ filename: "logo.png", mimeType: "image/png", size: 120_000 }] });
    expect(String(mocks.launched[0]!.context)).toContain("logo.png (image/png, 117 KB)");
  });
});

describe("the files Len presented in an email turn", () => {
  const delivered = (name: string, size: number) => ({ name, size, url: `/api/projects/${PROJECT}/deliveries/req-1/0123abcd-${encodeURIComponent(name)}` });
  it("🔴 go attached to the reply; what doesn't fit, as a link in its text", async () => {
    const { startEmailRequest } = await import("./run");
    await startEmailRequest(req());
    const cards = [{ tool: "present", status: "done", summary: "", delivered: [delivered("small.pdf", 1_000), delivered("big.mp4", 50 * 1024 * 1024)] }];
    await (mocks.launched[0]!.reply as (t: string, c: unknown) => Promise<void>)("Aquí está.", cards);
    expect(mocks.attached).toEqual([["small.pdf"]]);
    expect(mocks.log.find((l) => l.startsWith("send"))).toContain("big.mp4: https://openlen.com/api/projects/");
  });
});

describe("tras un reinicio", () => {
  it("🔴 reenvía lo ya contestado, corre lo que no empezó, y avisa de lo cortado o viejo — sin repetir turnos", async () => {
    mocks.pending = [
      { ...req({ id: "con-respuesta", respuesta: "Ya está." }), started: true },
      { ...req({ id: "sin-empezar" }), started: false },
      { ...req({ id: "cortado" }), started: true },
      { ...req({ id: "viejo", createdAt: new Date(Date.now() - 3 * 86_400_000) }), started: false },
    ];
    const { resumeEmailRequests } = await import("./run");
    expect(await resumeEmailRequests()).toBe(4);
    expect(mocks.launched.map((l) => l.filaId)).toEqual(["sin-empezar"]);
    expect(mocks.log).toContain("send ana@gmail.com: Ya está.");
    expect(mocks.log.find((l) => l.startsWith("send") && l.includes("Se reinició el servidor"))).toBeTruthy();
    expect(mocks.log.find((l) => l.startsWith("send") && l.includes("No llegué a hacerlo"))).toBeTruthy();
    expect(mocks.log.filter((l) => l.startsWith("mark"))).toEqual(["mark con-respuesta", "mark cortado", "mark viejo"]);
  });

  it("apagado (sin dominio) no consulta nada", async () => {
    vi.stubEnv("LEN_EMAIL_DOMAIN", "");
    mocks.pending = [{ ...req(), started: false }];
    const { resumeEmailRequests } = await import("./run");
    expect(await resumeEmailRequests()).toBe(0);
    expect(mocks.launched).toHaveLength(0);
  });
});
