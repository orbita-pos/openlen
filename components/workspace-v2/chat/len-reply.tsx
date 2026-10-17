"use client";

/**
 * LEN'S REPLY, WITH ITS VISUALS WHERE IT PUT THEM (local spec
 * 2026-10-16-len-inline-visuals, §4.5).
 *
 * The text is cut at each `show_widget` card's `textOffset`; the visual being
 * written (`turn.liveWidget`) goes in too. A visual keeps its key from the
 * first chunk to its card — the k-th `show_widget` of the turn is `visual-k`
 * live and stored — so the frame is the same one and only its code finishes.
 */
import { TextoDeLen } from "../texto-de-len";
import { SHOW_WIDGET } from "@/lib/agent/visuals/widget";
import { splitReplyAtWidgets, type ReplyWidget } from "@/lib/visuals/split-reply";
import type { DesignTurn } from "./use-agent-chat";
import { VisualFrame } from "./visual-frame";

const TEXT_CLASS = "m-0 whitespace-pre-wrap break-words text-[14px] leading-[1.62] fg [text-wrap:pretty]";

export function LenReply({
  turn,
  text,
  streaming,
  paths,
  onOpenFile,
  onPrompt,
}: {
  turn: DesignTurn;
  /** The text to show (the turn's, without a trailing question already in its card). */
  text: string;
  streaming: boolean;
  paths: readonly string[];
  onOpenFile?: (path: string) => void;
  /** Sends a visual's prompt as the person's message; absent for a reader. */
  onPrompt?: (text: string) => void;
}) {
  const stored = (turn.actions ?? []).filter((a) => a.tool === SHOW_WIDGET && a.widget);
  const widgets: { key: string; offset: number | undefined; widget: ReplyWidget; live: boolean }[] = stored.map((a, k) => ({
    key: `visual-${k}`,
    offset: a.textOffset,
    widget: a.widget!,
    live: false,
  }));
  if (turn.liveWidget) {
    widgets.push({ key: `visual-${stored.length}`, offset: turn.liveWidget.textOffset, widget: turn.liveWidget, live: true });
  }

  const parts = splitReplyAtWidgets(text, widgets);
  const lastText = parts.map((p) => p.kind).lastIndexOf("text");
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <p key={`text-${i}`} className={TEXT_CLASS}>
            <TextoDeLen texto={p.text} rutas={paths} {...(onOpenFile ? { onAbrir: onOpenFile } : {})} />
            {streaming && i === lastText && <span className="nc-caret" />}
          </p>
        ) : (
          <VisualFrame key={p.key} widget={p.widget} final={!p.live} {...(onPrompt ? { onPrompt } : {})} />
        ),
      )}
    </>
  );
}
