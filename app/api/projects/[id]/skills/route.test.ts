import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/agent/skills/store", () => ({ listSkills: vi.fn() }));
vi.mock("@/lib/projects", () => ({ getProject: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { listSkills } from "@/lib/agent/skills/store";
import { getProject } from "@/lib/projects";

const text = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\nDo it.\n`;
const pedir = () => GET(new Request("http://localhost/api/projects/p1/skills"), { params: Promise.resolve({ id: "p1" }) });

beforeEach(() => {
  vi.mocked(getProject).mockResolvedValue(null as never);
  vi.mocked(auth).mockResolvedValue({ user: { id: "ana" } } as never);
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "dueno-1" } as never);
  vi.mocked(listSkills).mockImplementation(async (scope, owner) =>
    scope === "project" ? [{ name: "cotizar", text: text("cotizar"), updatedAt: new Date(0) }] : owner === "ana" ? [{ name: "de-ana", text: text("de-ana"), updatedAt: new Date(0) }] : [{ name: "del-dueno", text: text("del-dueno"), updatedAt: new Date(0) }],
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/projects/[id]/skills", () => {
  it("lists the skills the person asking can invoke, theirs and never another member's", async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    const { skills } = (await res.json()) as { skills: { name: string; scope: string }[] };
    const names = skills.map((s) => s.name);
    expect(names).toContain("office-xlsx");
    expect(names).toContain("cotizar");
    expect(names).toContain("de-ana");
    expect(names).not.toContain("del-dueno");
    expect(listSkills).toHaveBeenCalledWith("personal", "ana");
    expect(skills.find((s) => s.name === "cotizar")?.scope).toBe("project");
  });

  it("answers the access refusal as it comes", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue(new Response(null, { status: 404 }) as never);
    expect((await pedir()).status).toBe(404);
  });

  it("401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await pedir()).status).toBe(401);
  });

  // Spec local 2026-10-27-len-five-skills, §4.2: OpenLen's skills depend on whether the project is a
  // page or an app, and the menu lists what this project offers, read from the owner's project.
  it("lists the generated skills this project offers, reading the owner's project", async () => {
    vi.mocked(getProject).mockResolvedValue({ data: { html: "" } } as never);
    vi.stubEnv("OPENLEN_ARTIFACTS", "1");
    vi.stubEnv("OPENLEN_ARTIFACT_RENDERER_IMAGE", "openlen/artifact-renderer:2");
    const names = ((await (await pedir()).json()) as { skills: { name: string }[] }).skills.map((s) => s.name);
    expect(getProject).toHaveBeenCalledWith("p1", "dueno-1");
    expect(names).toContain("artifact-slides");
  });

  it("a page offers convert-to-app; an app doesn't", async () => {
    const list = async () => ((await (await pedir()).json()) as { skills: { name: string }[] }).skills.map((s) => s.name);
    vi.mocked(getProject).mockResolvedValue({ data: { html: "" } } as never);
    expect(await list()).toContain("convert-to-app");
    vi.mocked(getProject).mockResolvedValue({ data: { html: "", app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } } as never);
    expect(await list()).not.toContain("convert-to-app");
  });

  it("empty with OPENLEN_SKILLS=0", async () => {
    vi.stubEnv("OPENLEN_SKILLS", "0");
    expect(await (await pedir()).json()).toEqual({ skills: [] });
  });
});
