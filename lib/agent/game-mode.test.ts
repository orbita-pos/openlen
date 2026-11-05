// @vitest-environment node
// LEN'S GAME POSTURE (spec local 2026-11-05-modo-juego-design, §8.4): the app's prompt and manual, with what is
// false in a game said for a game — and nothing else moves.
import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt } from "@/lib/agent/catalog";
import { buildManualDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import { PROBAR_LA_APP } from "@/lib/agent/modo-app";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import { ENTRADA } from "@/lib/apps/esqueleto";

const app = { catalogo: CATALOGO_ACTUAL, entrada: ENTRADA };

describe("the game posture's prompt", () => {
  const p = buildAgentSystemPrompt({}, "len", app, false, true);

  it("says it is a game and sends Len to the skill before building", () => {
    expect(p).toContain("GAME POSTURE");
    expect(p).toContain("game-development");
    expect(p).toMatch(/\bthree\b/);
    expect(p).toContain("Phaser");
    expect(p).toMatch(/blockout/i);
  });

  it("speaks of neither hash-routed screens nor a business's records", () => {
    expect(p).not.toContain("hash routes");
    expect(p).not.toContain("<Route");
    expect(p).not.toContain("What the app shows about THEIR business");
  });

  it("says where the game and its assets go, never in the reserved /assets/", () => {
    for (const where of ["/src/game", "/models", "/textures", "/sounds", "/img", "/ASSETS.md"]) expect(p, where).toContain(where);
    expect(p).not.toContain("/assets/");
  });

  it("testing is playing: keys with use_page, the box for what is held, and saying what it couldn't see", () => {
    expect(p).toContain("use_page");
    expect(p).toContain("When it moves");
    expect(p).toContain("couldn't verify");
    expect(p).not.toContain(PROBAR_LA_APP);
  });

  it("🔴 an app, a tool and a page come out byte for byte as without a game", () => {
    expect(buildAgentSystemPrompt({}, "len", app, false, false)).toBe(buildAgentSystemPrompt({}, "len", app));
    expect(buildAgentSystemPrompt({}, "len", app, true, true)).toBe(buildAgentSystemPrompt({}, "len", app, true));
    expect(buildAgentSystemPrompt({}, "len", null, false, true)).toBe(buildAgentSystemPrompt({}, "len", null));
  });
});

describe("the game posture's manual", () => {
  const m = buildManualDeLaPlataforma({ OPENLEN_TERMINAL: "0" }, "len", app, false, false, true);

  it("promises neither a router, nor routes, nor <Link>, nor a backend client that exists", () => {
    for (const x of ["<HashRouter>", "SCREENS are hash routes", "<Link to=", "exports the backend client", "the client is created once in"]) {
      expect(m, x).not.toContain(x);
    }
  });

  it("says how a game that saves data creates its client, and has its Game section", () => {
    expect(m).toMatch(/A game that saves data[^\n]*\/src\/lib\/supabase\.ts/);
    expect(m).toContain("## Game");
    for (const where of ["/src/game/", "/models", "/textures", "/sounds", "/ASSETS.md"]) expect(m, where).toContain(where);
  });

  it("🔴 an app's and a tool's manuals come out byte for byte as without a game", () => {
    const env = { OPENLEN_TERMINAL: "0" };
    expect(buildManualDeLaPlataforma(env, "len", app, false, false, false)).toBe(buildManualDeLaPlataforma(env, "len", app, false));
    expect(buildManualDeLaPlataforma(env, "len", app, false, true, true)).toBe(buildManualDeLaPlataforma(env, "len", app, false, true));
  });
});
