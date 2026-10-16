// @vitest-environment jsdom
//
// The app-birth workshop: what lights up and what it says comes from Len's real
// turn (`lib/workspace-v2/app-birth.ts`). Real Spanish strings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsChrome from "@/messages/es/wsChrome.json";
import { workshopOf, type WorkshopAction } from "@/lib/workspace-v2/app-birth";

vi.mock("next/font/google", () => ({
  Schibsted_Grotesk: () => ({ variable: "head" }),
  Chivo_Mono: () => ({ variable: "note" }),
}));

const { AppBirthWorkshop } = await import("./app-birth-workshop");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // Without Next's compiler, `<style jsx global>` reaches React as plain attributes.
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("non-boolean attribute")) return;
    error(...args);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function show(actions: WorkshopAction[], finished = false) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsChrome }}>
        <AppBirthWorkshop view={workshopOf(actions)} finished={finished} appName="Inventario de granos" startedAt={Date.now()} />
      </NextIntlClientProvider>,
    ),
  );
}

const who = () => host.querySelector(".ab-who")?.textContent;
const headline = () => host.querySelector(".ab-now")?.textContent;
const note = () => host.querySelector(".ab-note")?.textContent?.trim();
const litLabels = () => [...host.querySelectorAll(".ab-label.ab-on")].map((l) => l.textContent);
const block = () => host.querySelector(".ab-block")?.textContent ?? "";

const todos = [
  { content: "Las reglas del inventario", status: "completed" },
  { content: "La pantalla de inicio", status: "in_progress" },
  { content: "Probarla en el teléfono", status: "pending" },
];

describe("the app-birth workshop", () => {
  it("before Len does anything, he is at the board organizing the work", () => {
    show([]);
    expect(who()).toBe("Len está trabajando en tu app");
    expect(headline()).toBe("Len está organizando el trabajo");
    expect(litLabels()).toEqual(["pizarra"]);
    expect(block()).toContain("Inventario de granos");
    expect(block()).toContain("—");
  });

  it("the step in progress is the headline, and what he is doing goes above it", () => {
    show([
      { tool: "todo_write", status: "done", summary: "", todos },
      { tool: "Write", status: "running", summary: "src/screens/Home.tsx" },
    ]);
    expect(who()).toBe("Len está escribiendo el código");
    expect(headline()).toBe("La pantalla de inicio");
    expect(note()).toBe("src/screens/Home.tsx");
    expect(litLabels()).toEqual(["escritorio"]);
    expect(block()).toContain("Paso 2 de 3");
  });

  it("a command lights the terminal and is typed on its screen", async () => {
    vi.useFakeTimers();
    try {
      show([{ tool: "bash", status: "running", summary: "npm run build" }]);
      expect(litLabels()).toEqual(["terminal"]);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(host.querySelector(".ab-screen")?.textContent).toBe("$ npm run build");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a long command is cut to what fits on the screen", async () => {
    vi.useFakeTimers();
    try {
      show([{ tool: "bash", status: "running", summary: "npx tsc --noEmit --pretty" }]);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(host.querySelector(".ab-screen")?.textContent).toBe("$ npx tsc --no…");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the board ticks the steps he finished", () => {
    show([{ tool: "todo_write", status: "done", summary: "", todos }]);
    expect(host.querySelectorAll(".ab-tick.ab-on")).toHaveLength(1);
  });

  it("when the app is ready, every lamp is on and it says so", () => {
    show([{ tool: "todo_write", status: "done", summary: "", todos }, { tool: "view_page", status: "done", summary: "" }], true);
    expect(who()).toBe("Len terminó");
    expect(headline()).toBe("Tu app está lista");
    expect(note()).toBe("");
    expect(litLabels()).toHaveLength(5);
    expect(host.querySelectorAll(".ab-tick.ab-on")).toHaveLength(3);
    expect(block()).toContain("Hecho");
  });
});
