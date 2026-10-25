// A5 of Len 3.1, DeepSeek's `tui-turn-end-stop-reason-notices` and `max-tokens-turn-end-notice` (MIT):
// every turn that does not complete says why it stopped, and the notice comes from the durable record,
// so a reload paints it again. The server keeps the code in `endReason`; until now a reloaded cut turn
// always said «cancelled», and a turn that failed without changing anything came back as a clean one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));

import { storedTurnFromRow, type ChatRowForTurn } from "@/lib/projects/stored-turn";
import type { EtiquetasDeRespuesta } from "../agent-reply-card";
import { LenTurn } from "./chat-turn";
import { restoreTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const nothing = () => {};
function reloaded(row: Partial<ChatRowForTurn>): string {
  const turn = restoreTurn(
    storedTurnFromRow({
      id: "t1",
      userText: "haz el hero azul",
      assistantReasoning: "Voy a cambiar el hero.",
      status: "applied",
      createdAt: new Date(0),
      attachedImage: null,
      actions: null,
      ...row,
    }),
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
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
      />,
    ),
  );
  return host.textContent ?? "";
}

describe("why a turn stopped, after a reload", () => {
  it("a cut turn says its real reason, not «cancelled»", () => {
    const text = reloaded({ status: "cortado", endReason: "upstream" });
    expect(text).toContain('cutShort {"reason":"errors.upstream"}');
    expect(text).not.toContain("errors.cancelled");
  });

  it("a turn that stopped in error without changing anything says why, instead of reading as a clean turn", () => {
    expect(reloaded({ noDocChange: true, endReason: "truncated" })).toContain('cutShort {"reason":"errors.truncated"}');
  });

  it("a completed turn and a limit turn add no notice (the limit's closing text already says it)", () => {
    expect(reloaded({})).not.toContain("cutShort");
    expect(reloaded({ endReason: "turn_limit" })).not.toContain("cutShort");
  });

  it("CONTROL: an old cut row without a reason keeps the generic notice", () => {
    expect(reloaded({ status: "cortado" })).toContain('cutShort {"reason":"errors.cancelled"}');
  });

  it("a value that is not a reason is ignored", () => {
    expect(reloaded({ endReason: "nonsense" })).not.toContain("cutShort");
  });
});
