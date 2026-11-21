// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import type { AssistantListItem } from "@/lib/assistants/view";

import type { ProyectoEnLista } from "../api/proyectos";
import { CHOSEN_KEY, WELCOME_DISMISSED_KEY, appModeOf, dismissWelcome, readChosen, readWelcomeDismissed, saveChosen } from "./app-mode";

const look = { v: 1, shape: "drop", color: "#3b82f6", eyes: "oval", eyewear: "none", accessory: "none" } as const;
const assistant = (id: string, name: string): AssistantListItem => ({ id, name, slug: id, look, color: "#3b82f6", tone: "friendly", projectId: "p1", projectIds: ["p1"] });
const MARTA = assistant("a2", "Marta");
const LUCIA = assistant("a1", "Lucía");
const MINE: ProyectoEnLista = { id: "p1", title: "Pan", subdomain: null, publishedAt: null, updatedAt: "2026-11-16" };
const SHARED: ProyectoEnLista = { ...MINE, id: "p9", compartido: { rol: "editor" } };
const base = { loaded: true, enabled: true, assistants: [] as AssistantListItem[], chosenId: null as string | null, projects: [MINE], welcomeDismissed: false };

afterEach(() => localStorage.clear());

describe("which assistant the app is (spec local 2026-11-16-movil-es-tu-asistente, §5.1)", () => {
  it("with one, she is the app", () => {
    expect(appModeOf({ ...base, assistants: [LUCIA] })).toEqual({ kind: "assistant", assistant: LUCIA });
  });

  it("with several, the one chosen on this phone", () => {
    expect(appModeOf({ ...base, assistants: [MARTA, LUCIA], chosenId: "a1" })).toEqual({ kind: "assistant", assistant: LUCIA });
  });

  it("with several and none chosen, the newest", () => {
    expect(appModeOf({ ...base, assistants: [MARTA, LUCIA] })).toEqual({ kind: "assistant", assistant: MARTA });
  });

  it("🔴 a saved assistant deleted on the web falls back to the newest", () => {
    expect(appModeOf({ ...base, assistants: [MARTA, LUCIA], chosenId: "gone" })).toEqual({ kind: "assistant", assistant: MARTA });
  });

  // Final review, I6: until her person's assistants are known, an empty list is not «none» — never the welcome.
  it("🔴 assistants not read yet (or the read failed): today's app, never the welcome", () => {
    expect(appModeOf({ ...base, loaded: false })).toEqual({ kind: "len", invite: false });
  });

  it("none yet, with a project of their own: the welcome", () => {
    expect(appModeOf(base)).toEqual({ kind: "welcome" });
  });

  it("none, the welcome dismissed: today's app, with an invitation", () => {
    expect(appModeOf({ ...base, welcomeDismissed: true })).toEqual({ kind: "len", invite: true });
  });

  it("none, and only others' projects: today's app, no invitation (creating her needs a project of their own)", () => {
    expect(appModeOf({ ...base, projects: [SHARED] })).toEqual({ kind: "len", invite: false });
  });

  // Agents for everyone, delivery 4 (spec local 2026-11-19-agentes-para-todos, §6.10): an agent made on the web lives in
  // the person's space, which attends none of their pages; the phone of someone with a page's assistant stays hers.
  const CHEF: AssistantListItem = { ...assistant("a3", "Chef Rosa"), projectId: "space", projectIds: ["space"] };

  it("🔴 with none chosen, an agent of your space doesn't take your page's assistant's place", () => {
    expect(appModeOf({ ...base, assistants: [CHEF, LUCIA] })).toEqual({ kind: "assistant", assistant: LUCIA });
  });

  // Delivery 4's deferred minor M1: before your pages arrive, «the newest that attends one of your pages» can't be told,
  // and the newest — an agent of your space — tinted «Cargando» and had her chat read before the app settled on Lucía.
  it("🔴 your pages not read yet, with several and none chosen: it waits, never guessing the newest", () => {
    expect(appModeOf({ ...base, projects: null, assistants: [CHEF, LUCIA] })).toEqual({ kind: "len", invite: false });
  });

  it("your pages not read yet: the only one, or the one chosen on this phone, is the app already", () => {
    expect(appModeOf({ ...base, projects: null, assistants: [LUCIA] })).toEqual({ kind: "assistant", assistant: LUCIA });
    expect(appModeOf({ ...base, projects: null, assistants: [CHEF, LUCIA], chosenId: "a3" })).toEqual({ kind: "assistant", assistant: CHEF });
    expect(appModeOf({ ...base, projects: null, assistants: [] })).toEqual({ kind: "len", invite: false });
  });

  it("with no pages, the newest agent", () => {
    expect(appModeOf({ ...base, projects: [], assistants: [CHEF, LUCIA] })).toEqual({ kind: "assistant", assistant: CHEF });
  });

  it("🔴 no pages and the only agent deleted on the web: today's app, never the welcome", () => {
    expect(appModeOf({ ...base, projects: [], assistants: [], chosenId: "a3" })).toEqual({ kind: "len", invite: false });
  });

  it("🔴 assistants off on the server: today's app, whatever is saved", () => {
    expect(appModeOf({ ...base, enabled: false, assistants: [LUCIA], chosenId: "a1" })).toEqual({ kind: "len", invite: false });
  });

  it("remembers the chosen one and the dismissed welcome on this phone", () => {
    expect(readChosen()).toBeNull();
    saveChosen("a2");
    expect(readChosen()).toBe("a2");
    expect(localStorage.getItem(CHOSEN_KEY)).toBe("a2");
    expect(readWelcomeDismissed()).toBe(false);
    dismissWelcome();
    expect(readWelcomeDismissed()).toBe(true);
    expect(localStorage.getItem(WELCOME_DISMISSED_KEY)).toBe("1");
  });
});
