// @vitest-environment node
//
// POST /api/tools/uploads and POST /api/tools/deliver (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6):
// the files the person picked in OpenLen's own picker, and a file a tool delivers — as the person, through the same
// caller check as the bridge (installed and theirs, or the draft of a tool project they can edit). The browser
// session only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tools/bridge/caller", () => ({ resolveBridgeCaller: vi.fn() }));
vi.mock("@/lib/tools/uploads", async (orig) => ({
  ...(await orig<typeof import("@/lib/tools/uploads")>()),
  saveToolUpload: vi.fn(async (_p: string, _t: string, f: { name: string; bytes: Uint8Array; contentType: string }) => ({ id: "up-0123456789abcdef", name: f.name, size: f.bytes.byteLength, contentType: f.contentType })),
  deliverFromTool: vi.fn(async () => ({ url: "/api/projects/tool-1/deliveries/deliver-x/abcd1234-r.pdf" })),
}));

const { auth } = await import("@/auth");
const { resolveBridgeCaller } = await import("@/lib/tools/bridge/caller");
const uploads = await import("@/lib/tools/uploads");
const { POST: UPLOAD } = await import("./route");
const { POST: DELIVER } = await import("../deliver/route");

const installed = { caller: { personId: "u1", personEmail: "a@b.c", locale: "es", timeZone: "UTC", mode: "installed", installation: { projectId: "tool-1" } } };

const form = (files: File[], extra: Record<string, string> = { installationId: "inst-1" }) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  for (const file of files) f.append("file", file);
  return f;
};
const post = (route: typeof UPLOAD, body: FormData) => route(new Request("http://x/api/tools/uploads", { method: "POST", body }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
  vi.mocked(resolveBridgeCaller).mockResolvedValue(installed as never);
});

describe("POST /api/tools/uploads", () => {
  it("saves each picked file as the person, under the tool's project", async () => {
    const res = await post(UPLOAD, form([new File([new Uint8Array(5)], "a.jpg", { type: "image/jpeg" }), new File([new Uint8Array(3)], "b.png", { type: "image/png" })]));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { uploads: unknown[] }).uploads).toHaveLength(2);
    expect(uploads.saveToolUpload).toHaveBeenCalledWith("u1", "tool-1", expect.objectContaining({ name: "a.jpg", contentType: "image/jpeg" }));
  });

  it("no session: 401; no files or more than 8: 400; the caller refused: its answer", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValueOnce(null);
    expect((await post(UPLOAD, form([new File(["x"], "a.txt")]))).status).toBe(401);
    expect((await post(UPLOAD, form([]))).status).toBe(400);
    expect((await post(UPLOAD, form(Array.from({ length: 9 }, (_, i) => new File(["x"], `${i}.txt`))))).status).toBe(400);
    vi.mocked(resolveBridgeCaller).mockResolvedValueOnce({ status: 402, body: { error: "plan_required" } });
    expect((await post(UPLOAD, form([new File(["x"], "a.txt")]))).status).toBe(402);
    expect(uploads.saveToolUpload).not.toHaveBeenCalled();
  });

  it("a file too large: 413 with its name", async () => {
    vi.mocked(uploads.saveToolUpload).mockRejectedValueOnce(new Error("too_large"));
    const res = await post(UPLOAD, form([new File(["x"], "big.bin")]));
    expect(res.status).toBe(413);
  });
});

describe("POST /api/tools/deliver", () => {
  it("delivers the tool's file under its project and answers its link", async () => {
    const res = await post(DELIVER, form([new File([new Uint8Array(30)], "reservas.pdf", { type: "application/pdf" })]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "/api/projects/tool-1/deliveries/deliver-x/abcd1234-r.pdf" });
    expect(uploads.deliverFromTool).toHaveBeenCalledWith("tool-1", expect.objectContaining({ name: "reservas.pdf", contentType: "application/pdf" }));
  });

  it("exactly one file", async () => {
    expect((await post(DELIVER, form([]))).status).toBe(400);
    expect((await post(DELIVER, form([new File(["x"], "a"), new File(["y"], "b")]))).status).toBe(400);
  });
});
