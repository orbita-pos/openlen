// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ insert: vi.fn(), createVersion: vi.fn(async () => undefined), thumbnail: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: m.insert }) }, schema: { projects: {} } }));
vi.mock("@/lib/projects/versions", () => ({ createVersion: m.createVersion }));
vi.mock("@/lib/projects/thumbnail", () => ({ renderProjectThumbnail: m.thumbnail }));

import { createProjectFromHtml, extractTitle } from "./create-from-html";

beforeEach(() => {
  m.insert.mockReset();
  m.insert.mockResolvedValue(undefined);
});

describe("crear un proyecto desde HTML", () => {
  it("el título sale del parámetro, si no del <title>, si no «Untitled page»", async () => {
    expect(extractTitle("<title> Café Luna </title>")).toBe("Café Luna");
    const r = await createProjectFromHtml({ userId: "u1", html: "<html><head><title>Café Luna</title></head><body><h1>x</h1></body></html>" });
    expect(r).toMatchObject({ ok: true, title: "Café Luna" });
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", status: "draft", data: expect.objectContaining({ html: expect.any(String) }) }));
  });

  it("🔴 rechaza el marcador del editor (data-slot-path), como from-html", async () => {
    const r = await createProjectFromHtml({ userId: "u1", html: '<div data-slot-path="hero.title">x</div>' });
    expect(r).toEqual({ ok: false, error: "invalid_html" });
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("vacío o de más de 8 MB: no crea", async () => {
    expect(await createProjectFromHtml({ userId: "u1", html: "   " })).toEqual({ ok: false, error: "empty" });
    expect(await createProjectFromHtml({ userId: "u1", html: "x".repeat(8 * 1024 * 1024 + 1) })).toEqual({ ok: false, error: "too_large" });
  });
});
