// @vitest-environment jsdom
// THE FIVE JOBS UNDER THE HOME'S BOX (spec local 2026-11-19-agentes-para-todos, §6.3): with Agente chosen, a tap fills
// the box with that job's sentence — it never sends.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import enChrome from "@/messages/en/wsChrome.json";
import esChrome from "@/messages/es/wsChrome.json";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { AGENT_JOBS, AgentJobChips } from "./agent-job-chips";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});

function mount(onPick: (text: string) => void) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<AgentJobChips onPick={onPick} />));
  return el;
}

describe("the five jobs", () => {
  it("🔴 are the five Jesús chose, in his order, and a tap hands back that job's sentence", () => {
    expect(AGENT_JOBS).toEqual(["language", "fitness", "finance", "legal", "cooking"]);
    const picked: string[] = [];
    const el = mount((t) => picked.push(t));
    const buttons = [...el.querySelectorAll<HTMLButtonElement>("[data-agent-job]")];
    expect(buttons.map((b) => b.textContent)).toEqual(AGENT_JOBS.map((j) => `start.kind.agentJobs.${j}`));
    act(() => buttons[3]!.click());
    expect(picked).toEqual(["start.kind.agentJobs.legalPrompt"]);
    expect(buttons.every((b) => b.type === "button")).toBe(true);
  });

  it("🔴 the language teacher is an English teacher everywhere but in English, where it is a language teacher", () => {
    expect(enChrome.start.kind.agentJobs.language).toBe("Language teacher");
    expect(esChrome.start.kind.agentJobs.language).toBe("Profesor de inglés");
  });
});
