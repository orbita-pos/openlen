// @vitest-environment jsdom
// THE REVIEW CARD OF THE PERSON'S SKILLS (spec local 2026-11-19-agentes-para-todos, §6.6): what Len's propose_skills left
// under his answer. The action carries the proposals' ids; the card asks the server for them — only the person who asked
// gets them (final review I1) — and «Guardar» saves the one the server keeps, by its id (C2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join(",")})` : key),
}));

import type { AgentAction } from "../agent-action-card";
import { SkillProposalsCard } from "./skill-proposals-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const NEW = { id: id(1), name: "plant-care", kind: "new", target: null, description: "Look after the person's plants.", skillMd: "---\nname: plant-care\ndescription: d\n---\n\nWater when dry.\n", saved: false };
const IMPROVE = { id: id(2), name: "bread", kind: "improvement", target: "bread", description: "d", skillMd: "---\nname: bread\ndescription: d\n---\n\nKnead.\n", saved: false };
const actionOf = (ids: string[]): AgentAction => ({ tool: "propose_skills", status: "done", summary: JSON.stringify({ ids }) }) as AgentAction;

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
/** GET answers `proposals`; POST answers `post`. */
function server(o: { proposals?: unknown[]; post?: () => Promise<Response> }) {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return o.post ? o.post() : reply(200, { saved: true });
    return reply(200, { proposals: o.proposals ?? [] });
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
  it("draws nothing without proposals, and asks for nothing", async () => {
    const el = await mount([{ tool: "Write", status: "done", summary: "x" } as AgentAction]);
    expect(el.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("🔴 asks the server for the turn's proposals by id", async () => {
    server({ proposals: [NEW] });
    await mount([actionOf([id(1)]), actionOf([id(2)])]);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/me/skills/proposals?ids=${id(1)},${id(2)}`);
  });

  it("🔴 someone else's proposals (the server gives none) draw nothing", async () => {
    server({ proposals: [] });
    const el = await mount([actionOf([id(1)])]);
    expect(el.querySelector("[data-skill-proposal]")).toBeNull();
  });

  it("one block per proposal: its name, new or improvement of its target, its description and the whole SKILL.md", async () => {
    server({ proposals: [NEW, IMPROVE] });
    const el = await mount([actionOf([id(1), id(2)])]);
    expect(block(el, "plant-care").textContent).toContain("skillProposal.new");
    expect(block(el, "plant-care").textContent).toContain("Look after the person's plants.");
    expect(block(el, "plant-care").querySelector("pre")!.textContent).toBe(NEW.skillMd);
    expect(block(el, "bread").textContent).toContain("skillProposal.improvement(bread)");
  });

  it("🔴 «Guardar» posts the proposal's id only, then says it is saved", async () => {
    server({ proposals: [IMPROVE] });
    const el = await mount([actionOf([id(2)])]);
    await click(block(el, "bread").querySelector<HTMLElement>("[data-skill-save]")!);
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("/api/me/skills");
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ proposalId: id(2) });
    expect(block(el, "bread").textContent).toContain("skillProposal.saved");
    expect(block(el, "bread").querySelector("[data-skill-save]")).toBeNull();
  });

  it("🔴 a skill that changed since Len proposed it: the card says so and saves nothing", async () => {
    server({ proposals: [IMPROVE], post: () => reply(409, { error: "changed" }) });
    const el = await mount([actionOf([id(2)])]);
    await click(block(el, "bread").querySelector<HTMLElement>("[data-skill-save]")!);
    expect(block(el, "bread").textContent).toContain("skillProposal.changed");
  });

  // Delivery 2's deferred minor: these two are answered as «No se pudo guardar. Inténtalo otra vez.», which no retry fixes.
  it("🔴 at the most skills a person can keep, the card says so, not «try again»", async () => {
    server({ proposals: [NEW], post: () => reply(409, { error: "limit" }) });
    const el = await mount([actionOf([id(1)])]);
    await click(block(el, "plant-care").querySelector<HTMLElement>("[data-skill-save]")!);
    expect(block(el, "plant-care").textContent).toContain("skillProposal.limit");
    expect(block(el, "plant-care").textContent).not.toContain("skillProposal.failed");
  });

  it("🔴 a name of one of OpenLen's own skills: the card says so, not «try again»", async () => {
    server({ proposals: [NEW], post: () => reply(409, { error: "reserved" }) });
    const el = await mount([actionOf([id(1)])]);
    await click(block(el, "plant-care").querySelector<HTMLElement>("[data-skill-save]")!);
    expect(block(el, "plant-care").textContent).toContain("skillProposal.reserved");
    expect(block(el, "plant-care").textContent).not.toContain("skillProposal.failed");
  });

  it("any other refusal says it couldn't be saved", async () => {
    server({ proposals: [NEW], post: () => reply(400, { error: "invalid" }) });
    const el = await mount([actionOf([id(1)])]);
    await click(block(el, "plant-care").querySelector<HTMLElement>("[data-skill-save]")!);
    expect(block(el, "plant-care").textContent).toContain("skillProposal.failed");
  });

  it("🔴 what the person already saved shows as saved (after a reload too)", async () => {
    server({ proposals: [{ ...NEW, saved: true }] });
    const el = await mount([actionOf([id(1)])]);
    expect(block(el, "plant-care").textContent).toContain("skillProposal.saved");
    expect(block(el, "plant-care").querySelector("[data-skill-save]")).toBeNull();
  });
});
