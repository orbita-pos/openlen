import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";
import { childToolDeclarations } from "@/lib/agent/subagents/presets";

import { assistantTools } from "./agent";
import { DEFAULT_LOOK, checkLook } from "@/lib/figure/look";
import { curatedLook } from "@/lib/figure/random";

import { CREATE_ASSISTANT, CREATE_ASSISTANT_DECLARATION, SUGGESTABLE, runCreateAssistant, suggestedLookOf } from "./create-tool";

const LEN = { projectId: "p1", userId: "u1" } as unknown as AgentSession;
const LUCIA = { id: "a1", name: "Lucía", slug: "lucia" };
const none = { assistantOfProject: async () => null, assistantsOf: async () => [], accentOf: async () => null, seed: () => 7 };

describe("create_assistant", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers the card when the project has no assistant", async () => {
    const out = await runCreateAssistant(LEN, {}, none);
    expect(out.response).toMatchObject({ ok: true, card: "assistant_create" });
    expect((out.response as { existing?: unknown }).existing).toBeUndefined();
    expect(out.action).toMatchObject({ tool: CREATE_ASSISTANT, ok: true });
  });

  // Phase 4 (spec §4.4, step 2): «Ya tienes a Lucía. ¿La uso también aquí o creas uno nuevo?»
  it("with an assistant elsewhere, Len hears its name and asks before making another", async () => {
    const seen: string[] = [];
    const out = await runCreateAssistant(LEN, {}, { ...none, assistantsOf: async (personId) => (seen.push(personId), [LUCIA as never]) });
    expect(seen).toEqual(["u1"]);
    expect(out.response).toMatchObject({ ok: true, card: "assistant_create", existing: [{ name: "Lucía", slug: "lucia" }] });
    const said = String((out.response as { tool_result?: string }).tool_result);
    expect(said).toContain("Lucía");
    expect(said).toMatch(/use .* here too or create another/i);
    expect(out.action).toMatchObject({ tool: CREATE_ASSISTANT, ok: true });
  });

  it("says which one it already has", async () => {
    const out = await runCreateAssistant(LEN, {}, { ...none, assistantOfProject: async () => LUCIA as never, assistantsOf: async () => [LUCIA as never] });
    expect(out.response).toMatchObject({ ok: false, error: "project_has_assistant", assistant: { name: "Lucía", slug: "lucia" } });
    expect(out.action).toBeUndefined();
  });

  // Phase 6 (spec local 2026-11-10-figuras-del-asistente, §5.6): Len may suggest her figure; the owner decides on the card.
  const lookOf = (out: Awaited<ReturnType<typeof runCreateAssistant>>) => suggestedLookOf(out.action?.summary);

  it("🔴 what Len suggests of her figure opens the creator, part by part", async () => {
    const look = lookOf(await runCreateAssistant(LEN, { shape: "heart", color: "#19C3B1", accessory: "crown" }, none))!;
    expect(look).toMatchObject({ shape: "heart", color: "#19c3b1", accessory: "crown" });
    expect(checkLook(look)).toEqual({ ok: true, value: look });
    // What he left unsaid comes from the look that goes well together.
    expect(look.eyes).toBe(curatedLook(7).eyes);
  });

  it("🔴 a part that is not of the catalog is dropped, never an error, and the rest stands", async () => {
    const out = await runCreateAssistant(LEN, { shape: "blob", eyes: "round", color: "red", accessory: 7 }, none);
    expect(out.response).toMatchObject({ ok: true, card: "assistant_create" });
    const look = lookOf(out)!;
    expect(look.eyes).toBe("round");
    expect(look.shape).toBe(curatedLook(7).shape);
    expect(look.color).toBe(curatedLook(7).color);
  });

  it("with no color from Len she opens in the page's own accent; with none, in a color of the palette", async () => {
    expect(lookOf(await runCreateAssistant(LEN, {}, { ...none, accentOf: async () => "#2F8BFF" }))!.color).toBe("#2f8bff");
    expect(lookOf(await runCreateAssistant(LEN, { color: "#112233" }, { ...none, accentOf: async () => "#2F8BFF" }))!.color).toBe("#112233");
    expect(lookOf(await runCreateAssistant(LEN, {}, { ...none, accentOf: async () => Promise.reject(new Error("no page")) }))!.color).toBe(curatedLook(7).color);
  });

  it("the suggestion fits where a turn keeps it (200 characters), and what is not one is none", async () => {
    const out = await runCreateAssistant(LEN, { shape: "triangle", eyes: "sleepy", eyewear: "shades", accessory: "headphones", color: "#ff5fa8" }, none);
    expect(out.action!.summary.length).toBeLessThanOrEqual(200);
    expect(suggestedLookOf("create_assistant")).toBeUndefined();
    expect(suggestedLookOf("create_assistant {not json")).toBeUndefined();
    expect(suggestedLookOf('create_assistant {"v":1,"shape":"blob"}')).toBeUndefined();
    expect(suggestedLookOf(undefined)).toBeUndefined();
  });

  // His tools are a cached prefix of every turn: the catalog growing must not move it.
  it("🔴 what Len may name is a list kept here, not the live catalog: adding an entry to the catalog changes no byte of his tools", () => {
    const p = CREATE_ASSISTANT_DECLARATION.parameters.properties as Record<string, { enum?: readonly string[] }>;
    for (const category of ["shape", "eyes", "eyewear", "accessory"] as const) {
      expect(p[category]!.enum).toEqual([...SUGGESTABLE[category]]);
      expect(Object.isFrozen(SUGGESTABLE[category])).toBe(true);
      // And every one of them is still a figure that draws.
      for (const id of SUGGESTABLE[category]) expect(checkLook({ ...DEFAULT_LOOK, [category]: id }).ok, `${category}: ${id}`).toBe(true);
    }
    expect(JSON.stringify(CREATE_ASSISTANT_DECLARATION)).toMatchInlineSnapshot(`"{"name":"create_assistant","description":"Shows the owner the card to create their own assistant: a chat assistant of theirs, with the name and the look they pick, that knows their business and talks with them about it — not you. Call it when the owner asks for an assistant, a chatbot or an AI of their own. It creates nothing: the owner names it and picks its look on the card. If this project already has one, you get which, and say so. You may suggest its figure — any of shape, eyes, eyewear, accessory and color — when something fits the business; the card opens with it and the owner changes whatever they like.","parameters":{"type":"OBJECT","properties":{"shape":{"type":"STRING","enum":["drop","round","capsule","cube","ears","heart","flower","triangle"],"description":"Optional. The figure's body."},"eyes":{"type":"STRING","enum":["oval","round","dot","smile","sleepy"],"description":"Optional."},"eyewear":{"type":"STRING","enum":["none","round","shades"],"description":"Optional."},"accessory":{"type":"STRING","enum":["none","beret","beanie","bow","crown","hat","headphones"],"description":"Optional. What it wears on its head."},"color":{"type":"STRING","description":"Optional. The figure's color as #RRGGBB. Left out, it takes the page's accent."}}}}"`);
  });

  it("is not the assistant's: an assistant doesn't make assistants", async () => {
    const session = { ...LEN, assistant: { id: "a1", name: "Lucía" } } as AgentSession;
    expect((await runCreateAssistant(session, {}, none)).response).toMatchObject({ ok: false, error: "not_available" });
    expect(assistantTools([CREATE_ASSISTANT_DECLARATION]).map((d) => d.name)).toEqual([]);
  });

  it("no subagent gets it", () => {
    expect(childToolDeclarations([CREATE_ASSISTANT_DECLARATION], "general-purpose", false).map((d) => d.name)).toEqual([]);
  });

  it("is off with the switch", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    expect((await runCreateAssistant(LEN, {}, none)).response).toMatchObject({ ok: false, error: "assistants_off" });
  });
});
