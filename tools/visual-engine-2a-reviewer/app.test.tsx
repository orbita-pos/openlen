import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualEngine2AReviewerApp } from "./app";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const dto = {
  progress: { decided: 0, total: 1 }, complete: false,
  current: {
    comparisonId: "comparison-1",
    left: { normalUrl: "/evidence/comparison-1/left/normal", neutralUrl: "/evidence/comparison-1/left/neutral" },
    right: { normalUrl: "/evidence/comparison-1/right/normal", neutralUrl: "/evidence/comparison-1/right/neutral" },
  },
};
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; host = undefined; });

async function render(submit = vi.fn(async () => undefined)) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<VisualEngine2AReviewerApp initial={dto} submit={submit} />));
  return { host, submit };
}

describe("Visual Engine 2A reviewer app", () => {
  it("shows exactly one randomized pair, neutral-copy tabs and no approve-all", async () => {
    const { host } = await render();
    expect(host.querySelectorAll("img")).toHaveLength(2);
    expect(host.textContent).toContain("Copy neutralized");
    expect(host.textContent?.toLowerCase()).not.toContain("approve all");
    expect(host.textContent).not.toContain("candidate");
    expect(host.textContent).not.toContain("baseline");
  });

  it("requires both signal checks and one short note before submitting", async () => {
    const { host, submit } = await render();
    const left = host.querySelector<HTMLButtonElement>("button[data-decision='left']")!;
    expect(left.disabled).toBe(true);
    const checks = host.querySelectorAll<HTMLSelectElement>("select");
    const note = host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      checks[0].value = "yes"; checks[0].dispatchEvent(new Event("change", { bubbles: true }));
      checks[1].value = "no"; checks[1].dispatchEvent(new Event("change", { bubbles: true }));
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(note, "clear visual identity"); note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(left.disabled).toBe(false);
    await act(async () => left.click());
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ comparisonId: "comparison-1", decision: "left" }));
  });
});
