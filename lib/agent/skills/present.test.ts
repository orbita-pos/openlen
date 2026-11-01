import { describe, expect, it, vi } from "vitest";

import { PRESENT_MAX_FILES, deliverableLocation, deliveredFrom, toolPresent } from "./present";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";

const XLSX = new Uint8Array([0x50, 0x4b, 3, 4, 7]);

function setup(box: Record<string, Uint8Array> | null) {
  const session = { projectId: "p1", userId: "u1", turnId: "t1" } as unknown as AgentSession;
  if (box) {
    session.terminal = {
      arrancada: true,
      readFileBytes: async (path: string) => box[path] ?? null,
    } as unknown as AgentSession["terminal"];
  }
  const stored: { name: string; bytes: Uint8Array; contentType: string }[] = [];
  const deps = {
    storeDeliverable: vi.fn(async (_p: string, _t: string, name: string, bytes: Uint8Array, contentType: string) => {
      stored.push({ name, bytes, contentType });
      return { url: `https://cdn.example/deliveries/p1/t1/${name}` };
    }),
  } as unknown as AgentDeps;
  return { session, deps, stored };
}

describe("present", () => {
  it("present uploads the box files and answers their urls", async () => {
    const { session, deps, stored } = setup({ "/tmp/office/inventario.xlsx": XLSX });
    const out = await toolPresent(session, deps, { files: [{ path: "/tmp/office/inventario.xlsx", description: "Inventory" }] });
    expect(out.response.ok).toBe(true);
    expect(out.response.files).toEqual([{ name: "inventario.xlsx", url: "https://cdn.example/deliveries/p1/t1/inventario.xlsx", size: 5, description: "Inventory" }]);
    expect(stored[0]!.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(out.delivered).toEqual(out.response.files);
    expect(out.action?.tool).toBe("present");
  });

  it("present refuses a missing path, a folder and a file over 20 MB, and uploads nothing", async () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    const { session, deps, stored } = setup({ "/tmp/office/ok.xlsx": XLSX, "/tmp/office/big.pptx": big });
    const missing = await toolPresent(session, deps, { files: [{ path: "/tmp/office/ok.xlsx" }, { path: "/tmp/office/nada.docx" }] });
    expect(missing.response.ok).toBe(false);
    expect(String(missing.response.error)).toContain("/tmp/office/nada.docx");
    const folder = await toolPresent(session, deps, { files: [{ path: "/tmp/office" }] });
    expect(folder.response.ok).toBe(false);
    const tooBig = await toolPresent(session, deps, { files: [{ path: "/tmp/office/big.pptx" }] });
    expect(String(tooBig.response.error)).toContain("20 MB");
    expect(stored).toEqual([]);
  });

  it(`present refuses more than ${PRESENT_MAX_FILES} files, and none`, async () => {
    const { session, deps } = setup({});
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `/tmp/office/${i}.xlsx` }));
    expect((await toolPresent(session, deps, { files: many })).response.error).toBe("present accepts 1 to 4 files");
    expect((await toolPresent(session, deps, { files: [] })).response.error).toBe("present accepts 1 to 4 files");
  });

  it("present without a box says there is no file to deliver", async () => {
    const { session, deps } = setup(null);
    const out = await toolPresent(session, deps, { files: [{ path: "/tmp/office/a.xlsx" }] });
    expect(out.response.ok).toBe(false);
    expect(String(out.response.error)).toMatch(/no file to deliver/i);
  });

  // Found by the real turn (26/10): the turn's terminal is a class (TurnSandbox) whose method uses
  // `this`; taking the method off the object and calling it bare lost it, and every read said "no file".
  it("reads through a terminal whose method needs its own this", async () => {
    class Box {
      private readonly files = new Map([["/tmp/office/a.xlsx", XLSX]]);
      readonly arrancada = true;
      async readFileBytes(path: string) {
        return this.files.get(path) ?? null;
      }
    }
    const { session, deps } = setup(null);
    session.terminal = new Box() as unknown as AgentSession["terminal"];
    const out = await toolPresent(session, deps, { files: [{ path: "/tmp/office/a.xlsx" }] });
    expect(out.response.ok, String(out.response.error)).toBe(true);
  });

  // Claude Code's verify sends its screenshots to the reader; Len's are kept by view_page and use_page
  // (lib/agent/tools.ts), and present delivers one even when no box ran this turn.
  it("present delivers a screenshot the turn kept, without a box", async () => {
    const { session, deps, stored } = setup(null);
    session.screenshots = new Map([["/tmp/screenshots/1.jpg", new Uint8Array([0xff, 0xd8, 0xff])]]);
    const out = await toolPresent(session, deps, { files: [{ path: "/tmp/screenshots/1.jpg", description: "The form after sending it" }] });
    expect(out.response.ok, String(out.response.error)).toBe(true);
    expect(stored[0]).toMatchObject({ name: "1.jpg", contentType: "image/jpeg" });
  });

  it("a relative path is the box's root", async () => {
    const { session, deps } = setup({ "/informe.docx": XLSX });
    expect((await toolPresent(session, deps, { files: [{ path: "informe.docx" }] })).response.ok).toBe(true);
  });
});

// What `present` delivers is private (spec local 2026-10-26-len-skills, §4.9; like DeepSeek's host,
// which exposes the presented file to the session, and Claude's files): kept in the private store and
// served only through the project's route, which checks access.
describe("present: the PDF preview of Office files", () => {
  const PDF = new TextEncoder().encode("%PDF-1.7");

  function withBox(files: Record<string, Uint8Array>, convert: (command: string, timeoutMs: number) => Promise<number>) {
    const { session, deps, stored } = setup(null);
    const made = new Map<string, Uint8Array>();
    const ejecutar = vi.fn(async (command: string, o?: { timeoutMs?: number }) => {
      const exitCode = await convert(command, o?.timeoutMs ?? 0);
      const outdir = /--outdir '([^']+)'/.exec(command)?.[1];
      const source = /'([^']+)'$/.exec(command)?.[1] ?? "";
      if (exitCode === 0 && outdir) made.set(`${outdir}/${source.split("/").pop()!.replace(/\.[^.]+$/, "")}.pdf`, PDF);
      return { stdout: "", stderr: "", exitCode, ficheros: null };
    });
    session.terminal = {
      arrancada: true,
      ejecutar,
      readFileBytes: async (path: string) => files[path] ?? made.get(path) ?? null,
    } as unknown as AgentSession["terminal"];
    return { session, deps, stored, ejecutar };
  }

  it("a deck gets a preview stored next to it", async () => {
    const { session, deps, stored } = withBox({ "/out/deck.pptx": XLSX }, async () => 0);
    const out = await toolPresent(session, deps, { files: [{ path: "/out/deck.pptx" }] });
    expect(out.response.ok).toBe(true);
    expect(stored.map((s) => s.name)).toEqual(["deck.pptx", "deck.pptx.preview.pdf"]);
    expect(stored[1]!.contentType).toBe("application/pdf");
    expect(out.delivered).toEqual([{ name: "deck.pptx", url: "https://cdn.example/deliveries/p1/t1/deck.pptx", size: 5, preview: "https://cdn.example/deliveries/p1/t1/deck.pptx.preview.pdf" }]);
  });

  it("a conversion that fails or runs out of time delivers the file without a preview", async () => {
    const { session, deps, stored } = withBox({ "/out/big.xlsx": XLSX }, async () => 124);
    const out = await toolPresent(session, deps, { files: [{ path: "/out/big.xlsx" }] });
    expect(out.response.ok).toBe(true);
    expect(stored.map((s) => s.name)).toEqual(["big.xlsx"]);
    expect(out.delivered![0]).not.toHaveProperty("preview");
  });

  it("two Office files share one budget of 60 seconds", async () => {
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const budgets: number[] = [];
      const { session, deps } = withBox({ "/out/a.docx": XLSX, "/out/b.docx": XLSX, "/out/c.docx": XLSX }, async (_c, timeoutMs) => {
        budgets.push(timeoutMs);
        clock += 45_000;
        return 0;
      });
      const out = await toolPresent(session, deps, { files: [{ path: "/out/a.docx" }, { path: "/out/b.docx" }, { path: "/out/c.docx" }] });
      expect(budgets).toEqual([60_000, 15_000]);
      expect(out.delivered!.map((d) => Boolean(d.preview))).toEqual([true, true, false]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("a PDF or an image is never converted", async () => {
    const { session, deps, ejecutar } = withBox({ "/out/a.pdf": PDF, "/out/b.png": XLSX }, async () => 0);
    await toolPresent(session, deps, { files: [{ path: "/out/a.pdf" }, { path: "/out/b.png" }] });
    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe("deliverableLocation", () => {
  it("keys it under the project and the turn, and serves it through the project's route", () => {
    expect(deliverableLocation("p1", "t-1", "Inventario tienda.xlsx", "ab12cd34")).toEqual({
      key: "deliveries/p1/t-1/ab12cd34-Inventario-tienda.xlsx",
      url: "/api/projects/p1/deliveries/t-1/ab12cd34-Inventario-tienda.xlsx",
    });
  });

  it("a name that tries to leave its folder stays in it", () => {
    const { key } = deliverableLocation("p1", "t1", "../../etc/passwd", "ab12cd34");
    expect(key.startsWith("deliveries/p1/t1/ab12cd34-")).toBe(true);
    expect(key.split("/")).toHaveLength(4);
    expect(key).not.toContain("..");
  });

  it("an accented name is kept, encoded in the url", () => {
    const { key, url } = deliverableLocation("p1", "t1", "menú.docx", "ab12cd34");
    expect(key).toBe("deliveries/p1/t1/ab12cd34-menú.docx");
    expect(url).toBe("/api/projects/p1/deliveries/t1/ab12cd34-men%C3%BA.docx");
  });
});

describe("deliveredFrom", () => {
  it("keeps what a card needs and drops the rest", () => {
    const url = "/api/projects/p1/deliveries/t1/ab12cd34-a.xlsx";
    expect(deliveredFrom([{ name: "a.xlsx", url, size: 3, extra: 1 }, { name: 4 }, "x"])).toEqual([{ name: "a.xlsx", url, size: 3 }]);
    expect(deliveredFrom([{ name: "a.xlsx", url: "javascript:alert(1)", size: 3 }])).toBeNull();
    expect(deliveredFrom("nope")).toBeNull();
  });

  // Review of the branch (26/10): the chat is shared among a project's members and the browser saves
  // its own cards, so a card links only where `present` puts a file — the project's route, which
  // checks access — and never to another site or another page of this one.
  it("only links to a delivery's route", () => {
    for (const url of [
      "https://evil.example/a.xlsx",
      "//evil.example/a.xlsx",
      "/\\evil.example/a.xlsx",
      "/uploads/deliveries/p1/t1/a.xlsx",
      "/api/projects/p1/publish",
      "/api/projects/p1/deliveries/t1/../../publish",
      "/api/projects/p1/deliveries/t1/ab12cd34-a.xlsx?x=1",
    ]) {
      expect(deliveredFrom([{ name: "a.xlsx", url, size: 3 }])).toBeNull();
    }
    expect(deliveredFrom([{ name: "menú.docx", url: "/api/projects/p1/deliveries/t1/ab12cd34-men%C3%BA.docx", size: 3 }])).toHaveLength(1);
  });

  it("keeps a preview only when it is a delivery's route too", () => {
    const url = "/api/projects/p1/deliveries/t1/ab12cd34-deck.pptx";
    const preview = "/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf";
    expect(deliveredFrom([{ name: "deck.pptx", url, size: 3, preview }])).toEqual([{ name: "deck.pptx", url, size: 3, preview }]);
    expect(deliveredFrom([{ name: "deck.pptx", url, size: 3, preview: "https://evil.example/x.pdf" }])).toEqual([{ name: "deck.pptx", url, size: 3 }]);
  });
});
