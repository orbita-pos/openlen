// LAYER 1 OF LEN 3.1 (spec local 2026-10-24-len-3-1-layers-0-1, §5.3): the real
// production turns of the replay scenes, painted the way the panel paints them,
// with the checks that would have caught what Jesús found by hand on 24/10 —
// blank gaps, URLs that were not links, a task list stuck at 0 of 5. The rows
// live outside the repo (`npm run replay-scenes:fetch`); without them each test
// says so and passes, except under the deploy gate (OPENLEN_GATE=1).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));

import { latestTodosOfActions } from "@/lib/agent/todo-list";
import { readScene, scenes } from "@/lib/agent/replay-scenes/scene-files";
import { storedTurnOfSceneRow } from "@/lib/agent/replay-scenes/scene-turns";
import type { EtiquetasDeRespuesta } from "../agent-reply-card";
import { LenTurn, UserMessage } from "./chat-turn";
import { restoreTurn, type DesignTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
function mount(node: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const nothing = () => {};
function paint(turn: DesignTurn): HTMLElement {
  return mount(
    <>
      <UserMessage turn={turn} initial="J" />
      <LenTurn
        turn={turn}
        next={undefined}
        isLast
        currentPage={null}
        projectId="p"
        when="now"
        vote={undefined}
        labels={{} as EtiquetasDeRespuesta}
        onRetry={nothing}
        onPublished={nothing}
        onConfirmSettled={nothing}
        onAnswerQuestion={nothing}
        onDismissQuestion={nothing}
        onRate={async () => true}
        onClearRate={async () => true}
      />
    </>,
  );
}

/** The URL a reader sees in plain text: trailing punctuation and an unbalanced `)` are not part of it. */
function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"'`]+/g)].map(([u]) => {
    let url = u.replace(/[.,;:!?]+$/, "");
    while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1).replace(/[.,;:!?]+$/, "");
    return url;
  });
}
/** Markdown links in Len's text, outside code. */
function markdownLinksIn(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1]!);
}

describe("real production scenes paint without the 24/10 defects", () => {
  for (const scene of scenes) {
    it(`scene ${scene.name}: no blank gaps, every URL a link, the task count right, no console errors`, () => {
      const file = readScene(scene.name);
      if (!file) {
        if (process.env.OPENLEN_GATE === "1") throw new Error(`scene ${scene.name} missing: run npm run replay-scenes:fetch`);
        console.warn(`⚠ scene ${scene.name} not downloaded — skipped`);
        return;
      }
      const from = file.rows.findIndex((r) => r.id === scene.rowIds[0]);
      const to = file.rows.findIndex((r) => r.id === scene.rowIds.at(-1));
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const row of file.rows.slice(from, to + 1)) {
        const turn = restoreTurn(storedTurnOfSceneRow(row));
        const host = paint(turn);
        const where = `row ${row.id}`;

        // Each run of adjacent text nodes, as the browser lays it out; an element
        // between two runs (a link, a path) breaks them. Code keeps its blank lines.
        const textRuns = (el: Element): string[] => {
          const runs = [""];
          for (const n of el.childNodes) {
            if (n.nodeType === Node.TEXT_NODE) runs[runs.length - 1] += n.textContent ?? "";
            else runs.push("");
          }
          return runs;
        };
        const gap = [...host.querySelectorAll("*")].find((el) => !el.closest("pre, code") && textRuns(el).some((t) => t.includes("\n\n\n")));
        expect(gap, `${where}: an element shows a blank gap`).toBeUndefined();

        const hrefs = [...host.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!);
        for (const href of hrefs) expect(/^https?:\/\//.test(href), `${where}: a link to ${href.slice(0, 12)}…`).toBe(true);
        for (const url of [...urlsIn(row.userText), ...markdownLinksIn(row.assistantReasoning)]) {
          expect(hrefs, `${where}: a URL that is not a link`).toContain(url);
        }

        const todos = latestTodosOfActions(turn.actions);
        if (todos && todos.length > 0) {
          const done = todos.filter((t) => t.status === "completed").length;
          expect(host.textContent, `${where}: the task count`).toContain(`newChat.todos.progress ${JSON.stringify({ done, total: todos.length })}`);
        }
        act(() => roots.pop()!.unmount());
      }
      expect(errors.mock.calls.map((c) => String(c[0]).slice(0, 200))).toEqual([]);
    });
  }
});
