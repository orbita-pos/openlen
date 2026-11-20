// @vitest-environment jsdom
// THE REVIEW CARD OF THE PERSON'S SKILLS (spec local 2026-11-19-agentes-para-todos, §6.6): what Len's propose_skills left
// under his answer. «Guardar» saves it as theirs; a reload knows what they already saved; a skill that changed since is
// never overwritten.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join(",")})` : key),
}));

import type { AgentAction } from "../agent-action-card";
import { SkillProposalsCard } from "./skill-proposals-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NEW = { name: "plant-care", kind: "new", target: null, description: "Look after the person's plants.", skillMd: "---\nname: plant-care\ndescription: Look after the person's plants.\n---\n\nWater when dry.\n", base: null, fingerprint: "a".repeat(64) };
const IMPROVE = { ...NEW, name: "bread", kind: "improvement", target: "bread", skillMd: "---\nname: bread\ndescription: d\n---\n\nKnead.\n", base: "b".repeat(64), fingerprint: "c".repeat(64) };
const actionOf = (proposals: unknown[]): AgentAction => ({ tool: "propose_skills", status: "done", summary: JSON.stringify({ proposals }) }) as AgentAction;

const fetchMock = vi.fn();
const roots: Root[] = [];
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
/** GET answers `saved` per name; POST answers `post`. */
function server(o: { saved?: Record<string, string>; post?: () => Promise<Response> }) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST") return o.post ? o.post() : reply(200, { saved: true });
    const name = decodeURIComponent(String(url).split("/").pop()!);
    return reply(200, { fingerprint: o.saved?.[name] ?? null });
  });
}

async function mount(actions: AgentAction[]) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  await act(async () => root.render(<SkillProposalsCard actions={actions} />));
  return el;
}
const block = (el: HTMLElement, name: string) => el.querySelector<HTMLElement>(`[data-skill-proposal="${name}"]`)!;
const click = async (b: HTMLElement) => act(async () => b.click());

describe("the review card", () => {
  it("draws nothing without proposals", async () => {
    const el = await mount([{ tool: "Write", status: "done", summary: "x" } as AgentAction]);
    expect(el.innerHTML).toBe("");
  });

  it("one block per proposal: its name, new or improvement of its target, its description and the whole SKILL.md", async () => {
    server({});
    const el = await mount([actionOf([NEW, IMPROVE])]);
    expect(block(el, "plant-care").textContent).toContain("plant-care");
    expect(block(el, "plant-care").textContent).toContain("skillProposal.new");
    expect(block(el, "plant-care").textContent).toContain("Look after the person's plants.");
    expect(block(el, "plant-care").querySelector("pre")!.textContent).toBe(NEW.skillMd);
    expect(block(el, "bread").textContent).toContain("skillProposal.improvement(bread)");
  });

  it("🔴 «Guardar» posts name, skillMd and base, and then says it is saved", async () => {
    server({});
    const el = await mount([actionOf([IMPROVE])]);
    await click(block(el, "bread").querySelector<HTMLElement>("[data-skill-save]")!);
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("/api/me/skills");
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ name: "bread", skillMd: IMPROVE.skillMd, base: IMPROVE.base });
    expect(block(el, "bread").textContent).toContain("skillProposal.saved");
    expect(block(el, "bread").querySelector("[data-skill-save]")).toBeNull();
  });

  it("🔴 a skill that changed since Len proposed it: the card says so and saves nothing", async () => {
    server({ post: () => reply(409, { error: "changed" }) });
    const el = await mount([actionOf([IMPROVE])]);
    await click(block(el, "bread").querySelector<HTMLElement>("[data-skill-save]")!);
    expect(block(el, "bread").textContent).toContain("skillProposal.changed");
  });

  it("any other refusal says it couldn't be saved", async () => {
    server({ post: () => reply(400, { error: "invalid" }) });
    const el = await mount([actionOf([NEW])]);
    await click(block(el, "plant-care").querySelector<HTMLElement>("[data-skill-save]")!);
    expect(block(el, "plant-care").textContent).toContain("skillProposal.failed");
  });

  it("🔴 after a reload, what the person already saved shows as saved", async () => {
    server({ saved: { "plant-care": NEW.fingerprint } });
    const el = await mount([actionOf([NEW])]);
    expect(block(el, "plant-care").textContent).toContain("skillProposal.saved");
    expect(block(el, "plant-care").querySelector("[data-skill-save]")).toBeNull();
  });

  it("the same name proposed twice in a turn shows once, the last one", async () => {
    server({});
    const el = await mount([actionOf([NEW]), actionOf([{ ...NEW, description: "Second.", fingerprint: "d".repeat(64) }])]);
    expect(el.querySelectorAll('[data-skill-proposal="plant-care"]')).toHaveLength(1);
    expect(block(el, "plant-care").textContent).toContain("Second.");
  });
});
