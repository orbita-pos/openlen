// LEN MAKES THEMES AND APPLIES THEM (spec local 2026-11-27-temas-del-workspace, §4.4–4.5): `set_theme` is Claude Code's
// `/custom-theme <name> [session]` / `off` — it applies to whoever speaks, never to the owner when a member speaks — and
// `publish` in a theme project installs the theme for the speaker instead of publishing a site.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/themes/install", () => ({
  installTheme: vi.fn(async () => ({
    status: 200,
    body: {
      installation: { id: "inst-1", projectId: "p1", releaseSha: "sha", installedAt: "2026-11-27T00:00:00.000Z", updatedAt: "2026-11-27T00:00:00.000Z" },
      themes: [{ id: "scene", cost: { elements: 40, animated: 5, heavy: false }, glassOpacity: 0.62, addedReducedMotion: false }],
      contrastWarnings: [],
    },
  })),
}));

import { installTheme } from "@/lib/themes/install";

import { buildFunctionDeclarations } from "./catalog";
import { publishTheme, runSetTheme, SET_THEME, type SetThemeDeps } from "./theme-tools";
import { runAgentTool, type AgentDeps, type AgentSession } from "./tools";

const AVAILABLE = [
  { ref: "bundled:honu-lagoon", title: "Honu Lagoon", source: "bundled" as const },
  { ref: "bundled:night-reef", title: "Night Reef", source: "bundled" as const },
  { ref: "installed:inst-1:scene", title: "My pond", source: "installed" as const },
];

function deps(over: Partial<SetThemeDeps> = {}) {
  const choose = vi.fn<SetThemeDeps["choose"]>(async (_person, choice) =>
    choice.themeRef === null || AVAILABLE.some((t) => t.ref === choice.themeRef) ? { ok: true } : { ok: false, error: "unknown_theme" },
  );
  const d: SetThemeDeps = { enabled: () => true, available: vi.fn(async () => AVAILABLE), choose, ...over };
  return { d, choose };
}

const owner = { projectId: "p1", userId: "owner-1", uiLocale: "en" } as AgentSession;
const member = { projectId: "p1", userId: "owner-1", personId: "member-2", uiLocale: "en" } as AgentSession;

describe("set_theme", () => {
  it("applies a gallery theme to whoever speaks, everywhere", async () => {
    const { d, choose } = deps();
    const out = await runSetTheme(owner, { theme: "bundled:honu-lagoon", scope: "everywhere" }, d);
    expect(out.response).toEqual({ applied: "bundled:honu-lagoon", scope: "everywhere" });
    expect(choose).toHaveBeenCalledWith("owner-1", { scope: "everywhere", themeRef: "bundled:honu-lagoon" });
  });

  it("a member's choice is the member's, never the owner's — and «project» is this project", async () => {
    const { d, choose } = deps();
    const out = await runSetTheme(member, { theme: "bundled:night-reef", scope: "project" }, d);
    expect(out.response).toEqual({ applied: "bundled:night-reef", scope: "project" });
    expect(choose).toHaveBeenCalledWith("member-2", { scope: "project", projectId: "p1", themeRef: "bundled:night-reef" });
  });

  it("takes a name as the list prints it or as its title, in any case, like /custom-theme", async () => {
    const { d, choose } = deps();
    expect((await runSetTheme(owner, { theme: "Honu-Lagoon", scope: "everywhere" }, d)).response).toEqual({ applied: "bundled:honu-lagoon", scope: "everywhere" });
    expect((await runSetTheme(owner, { theme: "my pond", scope: "everywhere" }, d)).response).toEqual({ applied: "installed:inst-1:scene", scope: "everywhere" });
    expect(choose).toHaveBeenLastCalledWith("owner-1", { scope: "everywhere", themeRef: "installed:inst-1:scene" });
  });

  it("«off» clears the scope's pick", async () => {
    const { d, choose } = deps();
    const out = await runSetTheme(owner, { theme: "off", scope: "project" }, d);
    expect(out.response).toEqual({ applied: null, scope: "project" });
    expect(choose).toHaveBeenCalledWith("owner-1", { scope: "project", projectId: "p1", themeRef: null });
  });

  it("a ref the speaker can't use is unknown_theme, and nothing is saved", async () => {
    const { d } = deps();
    const out = await runSetTheme(owner, { theme: "installed:someone-elses:scene", scope: "everywhere" }, d);
    expect(out.response).toEqual({ ok: false, error: "unknown_theme" });
  });

  it("a scope that isn't one is refused before anything is read", async () => {
    const { d, choose } = deps();
    const out = await runSetTheme(owner, { theme: "bundled:honu-lagoon", scope: "session" }, d);
    expect(out.response).toMatchObject({ error: "bad_scope" });
    expect(choose).not.toHaveBeenCalled();
  });

  it("with themes off it does nothing", async () => {
    const { d, choose } = deps({ enabled: () => false });
    expect((await runSetTheme(owner, { theme: "bundled:honu-lagoon", scope: "everywhere" }, d)).response).toEqual({ ok: false, error: "themes_off" });
    expect(choose).not.toHaveBeenCalled();
  });

  // Ruling R24: a theme changes a person's view only in a turn they started.
  it.each([
    ["a server-started turn (scheduled task, Len Watch, «Hazlo», a goal round)", { unattended: true }],
    ["a turn an agent's message woke", { wokenByAgent: true }],
    ["a turn on a copy of the project", { inProjectCopy: true }],
  ])("refuses in %s, and nothing is read or saved", async (_label, extra) => {
    const { d, choose } = deps();
    const out = await runSetTheme({ ...owner, ...extra } as AgentSession, { theme: "bundled:honu-lagoon", scope: "everywhere" }, d);
    expect(out.response).toMatchObject({ error: "unattended" });
    expect(choose).not.toHaveBeenCalled();
    expect(d.available).not.toHaveBeenCalled();
  });

  it("the person's own assistant, talking with its owner, may apply one", async () => {
    const { d } = deps();
    const session = { ...owner, assistant: { id: "a1" } } as unknown as AgentSession;
    expect((await runSetTheme(session, { theme: "bundled:honu-lagoon", scope: "everywhere" }, d)).response).toEqual({ applied: "bundled:honu-lagoon", scope: "everywhere" });
  });

  it("is declared with themes on, and not with OPENLEN_THEMES=0", () => {
    expect(buildFunctionDeclarations({}).map((x) => x.name)).toContain(SET_THEME);
    expect(buildFunctionDeclarations({ OPENLEN_THEMES: "0" }).map((x) => x.name)).not.toContain(SET_THEME);
  });
});

describe("publish in a theme project", () => {
  it("installs the theme for the speaker and answers with what the install said", async () => {
    const install = vi.fn(async () => ({
      status: 200,
      body: {
        installation: { id: "inst-1", projectId: "p1", releaseSha: "sha", installedAt: "x", updatedAt: "x" },
        themes: [{ id: "scene", cost: { elements: 40, animated: 5, heavy: false }, glassOpacity: 0.62, addedReducedMotion: true }],
        contrastWarnings: [{ themeId: "scene", code: "glass_unmeasured" }],
      },
    }));
    const out = await publishTheme(member, install);
    expect(install).toHaveBeenCalledWith({ projectId: "p1", actorId: "member-2", locale: "en" });
    expect(out.response).toMatchObject({
      ok: true,
      installation: { id: "inst-1" },
      themes: [{ id: "scene", ref: "installed:inst-1:scene", glassOpacity: 0.62, addedReducedMotion: true, cost: { heavy: false } }],
      contrastWarnings: [{ themeId: "scene", code: "glass_unmeasured" }],
    });
  });

  it("a member hears that only the owner installs it", async () => {
    const out = await publishTheme(member, async () => ({ status: 403, body: { error: "owner_only" } }));
    expect(out.response).toMatchObject({ ok: false, error: "owner_only" });
    expect(String(out.response.message)).toContain("owner");
  });

  it("the gate's problems come back with their codes", async () => {
    const problems = [{ code: "script", file: "/themes/scene.svg" }];
    const out = await publishTheme(owner, async () => ({ status: 422, body: { error: "theme_manifest_invalid", problems } }));
    expect(out.response).toMatchObject({ ok: false, error: "theme_manifest_invalid", problems });
  });

  it("🔴 with themes off, Len's `publish` in a theme project refuses: it is never published as a website", async () => {
    const loadProject = vi.fn(async () => ({ data: { html: "<p>preview</p>", theme: { bornAt: "2026-11-27T00:00:00Z" } } }));
    const out = await runAgentTool({ ...owner } as AgentSession, { loadProject, saveProjectData: vi.fn() } as unknown as AgentDeps, "publish", {});
    expect(out.response).toMatchObject({ ok: false, error: "project_is_theme" });
    expect(String(out.response.message)).toContain("never published");
    expect(out.confirm).toBeUndefined();
  });

  it("Len's `publish` takes that road in a theme project, and never loads the project to publish it", async () => {
    const loadProject = vi.fn();
    const session = { ...owner, theme: true } as AgentSession;
    const out = await runAgentTool(session, { loadProject, saveProjectData: vi.fn() } as unknown as AgentDeps, "publish", {});
    expect(installTheme).toHaveBeenCalledWith({ projectId: "p1", actorId: "owner-1", locale: "en" });
    expect(out.response).toMatchObject({ ok: true, themes: [{ id: "scene", ref: "installed:inst-1:scene" }] });
    expect(out.confirm).toBeUndefined();
    expect(loadProject).not.toHaveBeenCalled();
  });
});
