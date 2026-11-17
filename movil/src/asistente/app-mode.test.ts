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
const base = { enabled: true, assistants: [] as AssistantListItem[], chosenId: null as string | null, projects: [MINE], welcomeDismissed: false };

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

  it("none yet, with a project of their own: the welcome", () => {
    expect(appModeOf(base)).toEqual({ kind: "welcome" });
  });

  it("none, the welcome dismissed: today's app, with an invitation", () => {
    expect(appModeOf({ ...base, welcomeDismissed: true })).toEqual({ kind: "len", invite: true });
  });

  it("none, and only others' projects: today's app, no invitation (creating her needs a project of their own)", () => {
    expect(appModeOf({ ...base, projects: [SHARED] })).toEqual({ kind: "len", invite: false });
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
