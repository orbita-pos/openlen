// THE CHAT'S «@» in a sent message (spec local 2026-10-27, §6.7): its mentions
// are painted as mentions, and hovering one outlines it on the canvas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { UserMessage } from "./chat-turn";
import type { DesignTurn } from "./use-agent-chat";
import { registerMentionCanvas } from "../mention-highlight";
import type { MentionRef } from "@/lib/mentions/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const posted: unknown[] = [];
vi.spyOn(window, "postMessage").mockImplementation(((m: unknown) => void posted.push(m)) as never);
const off = registerMentionCanvas({ window: () => window, page: () => null });
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  posted.splice(0);
});
void off;

const LINK: MentionRef = { type: "element", label: "@Enlace · Ver el mostrador", text: "Ver el mostrador", target: { type: "page", page: null, path: "a:nth-of-type(1)", tag: "a" } };

function paint(turn: Partial<DesignTurn>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<UserMessage turn={{ id: "t", userText: `haz ${LINK.label} más grande`, assistantReasoning: "", status: "applied", ...turn } as DesignTurn} initial="J" />));
  return host;
}

describe("mentions in a sent message", () => {
  it("🔴 are painted as mentions and outline their element on hover", () => {
    const host = paint({ mentions: [LINK] });
    const token = host.querySelector('[data-mencion="elemento"]');
    expect(token?.textContent).toBe(LINK.label);
    act(() => void token!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(posted).toContainEqual({ type: "openlen:mention-highlight", key: LINK.label, target: LINK.target });
    act(() => void token!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(posted.at(-1)).toEqual({ type: "openlen:mention-highlight", key: LINK.label, target: null });
  });

  it("a message without mentions paints its text as before", () => {
    expect(paint({}).querySelector('[data-mencion="elemento"]')).toBeNull();
  });
});
