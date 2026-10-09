// @vitest-environment node
// LEN POR CORREO: la puerta del correo que llega. Lo que no la pasa se tira
// en silencio; lo que la pasa se apunta (una sola vez) y es un turno de Len.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u-ana" } as { id: string } | undefined,
  rol: "dueno" as "dueno" | "editor" | "lector" | null,
  launched: [] as Record<string, unknown>[],
  stored: new Map<string, Record<string, unknown>>(),
  recent: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const schema = { users: { id: "id", email: "email" }, projects: { id: "id", title: "title" } };
  return {
    schema,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === schema.users ? (mocks.user ? [mocks.user] : []) : [{ title: "Café Luna" }]),
          }),
        }),
      }),
    },
  };
});
vi.mock("@/lib/projects/acceso", () => ({
  accesoAlProyecto: async () => (mocks.rol ? { rol: mocks.rol, duenoId: "u-ana" } : null),
  puede: (rol: string, permiso: string) => permiso === "ver" || rol !== "lector",
}));
vi.mock("@/lib/len-email/requests", async () => {
  const real = await vi.importActual<typeof import("@/lib/len-email/requests")>("@/lib/len-email/requests");
  return {
    dedupeKeyOf: real.dedupeKeyOf,
    recentEmailRequests: async () => mocks.recent,
    recordEmailRequest: async (r: Record<string, unknown> & { dedupeKey: string }) => {
      if (mocks.stored.has(r.dedupeKey)) return null;
      const row = { ...r, id: `req-${mocks.stored.size + 1}`, respuesta: null, createdAt: new Date() };
      mocks.stored.set(r.dedupeKey, row);
      return row;
    },
  };
});
vi.mock("@/lib/len-email/run", () => ({
  startEmailRequest: async (req: Record<string, unknown>) => void mocks.launched.push(req),
  resumeEmailRequests: async () => 0,
}));

import { lenEmailAddress } from "@/lib/len-email/address";

import { POST } from "./route";

const PROJECT = "0b6f4c1e-2a3d-4e5f-8a9b-1c2d3e4f5a6b";
const TOKEN = "t0k3n";

function correo(over: Record<string, unknown> = {}, token = TOKEN) {
  return new Request("http://x/api/len-email/inbound", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      to: lenEmailAddress(PROJECT),
      from: "Ana <ana@gmail.com>",
      subject: "Re: Café Luna",
      text: "Cambia el precio a 499\n\nEl jue, 9 oct 2026, Len escribió:\n> Listo",
      messageId: "<abc@mail.gmail.com>",
      authenticationResults: "mx.cloudflare.net; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com",
      ...over,
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("LEN_EMAIL_DOMAIN", "reply.openlen.com");
  vi.stubEnv("NEXTAUTH_SECRET", "s3cr3t");
  vi.stubEnv("LEN_EMAIL_INBOUND_TOKEN", TOKEN);
  mocks.user = { id: "u-ana" };
  mocks.rol = "dueno";
  mocks.launched = [];
  mocks.stored = new Map();
  mocks.recent = 0;
});

describe("POST /api/len-email/inbound", () => {
  it("🔴 un correo del dueño, firmado, se APUNTA y arranca el turno con lo que escribió (sin lo citado)", async () => {
    const res = await POST(correo());
    expect(res.status).toBe(202);
    expect(((await res.json()) as { turnId?: string }).turnId).toBe("req-1");
    expect(mocks.launched).toHaveLength(1);
    expect(mocks.launched[0]).toMatchObject({
      id: "req-1",
      userId: "u-ana",
      projectId: PROJECT,
      sender: "ana@gmail.com",
      subject: "Re: Café Luna",
      texto: "Cambia el precio a 499",
      idioma: "es",
      inReplyTo: "<abc@mail.gmail.com>",
      dedupeKey: "mid:<abc@mail.gmail.com>",
    });
  });

  it("🔴 el MISMO correo entregado dos veces no lanza dos turnos (ni cobra dos veces)", async () => {
    expect((await POST(correo())).status).toBe(202);
    const otra = await POST(correo());
    expect(otra.status).toBe(200);
    expect(((await otra.json()) as { ignored?: string }).ignored).toBe("duplicado");
    expect(mocks.launched).toHaveLength(1);
  });

  it("pasado el tope por hora del proyecto, no se apunta ni corre", async () => {
    mocks.recent = 20;
    expect(((await (await POST(correo())).json()) as { ignored?: string }).ignored).toBe("tope por hora");
    expect(mocks.launched).toHaveLength(0);
  });

  it("🔴 sin el secreto del Worker, 401; sin configurar, 503", async () => {
    expect((await POST(correo({}, "otro"))).status).toBe(401);
    vi.stubEnv("LEN_EMAIL_INBOUND_TOKEN", "");
    expect((await POST(correo())).status).toBe(503);
    expect(mocks.launched).toHaveLength(0);
  });

  it.each([
    ["un From falsificado (DMARC falla)", { authenticationResults: "mx.cloudflare.net; dkim=pass header.d=evil.com; dmarc=fail header.from=gmail.com" }],
    ["una respuesta automática", { autoSubmitted: "auto-replied" }],
    ["una dirección con la firma cambiada", { to: `len-${PROJECT.replace(/-/g, "")}-000000000000@reply.openlen.com` }],
    ["un correo vacío (sólo lo citado)", { text: "> Listo" }],
  ])("🔴 %s se tira en silencio: ni turno ni respuesta", async (_nombre, over) => {
    const res = await POST(correo(over));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ignored?: string }).ignored).toBeTruthy();
    expect(mocks.launched).toHaveLength(0);
    expect(mocks.stored.size).toBe(0);
  });

  it("🔴 quien no tiene cuenta, o sólo puede mirar el proyecto, no le habla a Len", async () => {
    mocks.user = undefined;
    expect(((await (await POST(correo())).json()) as { ignored?: string }).ignored).toBe("remitente sin cuenta");
    mocks.user = { id: "u-eli" };
    mocks.rol = "lector";
    expect(((await (await POST(correo())).json()) as { ignored?: string }).ignored).toBe("remitente sin permiso en el proyecto");
    expect(mocks.launched).toHaveLength(0);
  });

  it("un editor sí: el turno corre como él (y cobra al dueño, como en el chat)", async () => {
    mocks.user = { id: "u-eli" };
    mocks.rol = "editor";
    expect((await POST(correo())).status).toBe(202);
    expect(mocks.launched[0]).toMatchObject({ userId: "u-eli" });
  });
});
