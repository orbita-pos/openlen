import { describe, expect, it } from "vitest";

import type { AssistantListItem } from "@/lib/assistants/view";

import type { ProyectoEnLista } from "../api/proyectos";
import { projectStatusOf } from "./project-status";

const look = { v: 1, shape: "drop", color: "#3b82f6", eyes: "oval", eyewear: "none", accessory: "none" } as const;
const assistant = (id: string, projectIds: string[]): AssistantListItem => ({ id, name: id, slug: id, look, color: "#3b82f6", tone: "friendly", projectId: projectIds[0] ?? "", projectIds });
const LUCIA = assistant("lucia", ["p1"]);
const MARTA = assistant("marta", ["p2"]);
const project = (id: string, shared = false): ProyectoEnLista => ({ id, title: id, subdomain: null, publishedAt: null, updatedAt: "2026-11-16", ...(shared ? { compartido: { rol: "editor" as const } } : {}) });

describe("a project and her (spec local 2026-11-16-movil-es-tu-asistente, §5.6)", () => {
  it("one she serves", () => {
    expect(projectStatusOf(project("p1"), LUCIA, [LUCIA, MARTA])).toEqual({ kind: "hers" });
  });
  it("yours with no assistant: free for her to take", () => {
    expect(projectStatusOf(project("p3"), LUCIA, [LUCIA, MARTA])).toEqual({ kind: "free" });
  });
  it("yours with another of your assistants", () => {
    expect(projectStatusOf(project("p2"), LUCIA, [LUCIA, MARTA])).toEqual({ kind: "other", assistant: MARTA });
  });
  it("🔴 someone else's, shared with you, is only to look at — even if an id matched one of hers", () => {
    expect(projectStatusOf(project("p9", true), LUCIA, [LUCIA, MARTA])).toEqual({ kind: "notYours" });
    expect(projectStatusOf(project("p1", true), LUCIA, [LUCIA, MARTA])).toEqual({ kind: "notYours" });
  });
});
