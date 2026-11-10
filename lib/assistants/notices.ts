// HOW AN ask_len REQUEST ENDED, BACK TO THE ASSISTANT (spec local 2026-11-06-asistente-propio, §4.2). As DeepSeek's
// subagent settlements (lib/agent/subagents/notice.ts) and Claude Code's background task notifications: the outcome is
// kept durably and the assistant reads it as its own user message with its next request — never woken for it. A
// request still queued past LOST_AFTER_MS is told as lost: the queue lives in memory, and a restart loses it.
//
// Pure.

export type AskLenStatus = "queued" | "done" | "failed";

export interface AskLenNotice {
  readonly id: string;
  readonly request: string;
  readonly status: AskLenStatus;
  /** When it was passed to Len, ISO. */
  readonly at: string;
  /** Len's closing message, when it finished. */
  readonly closing?: string;
  /** Why the turn didn't run (its code), when it failed. */
  readonly reason?: string;
  /** The project it went to, by name, when she serves more than one (phase 4). */
  readonly project?: string;
}

export type ReadyNotice = AskLenNotice & { readonly lost?: true };

/** An hour: longer than any wait in the project's queue. */
export const LOST_AFTER_MS = 3_600_000;
/** As much of Len's closing message as a notice carries. */
export const CLOSING_MAX = 2_000;

/** The ones the assistant should hear now, oldest first. */
export function readyNotices(all: readonly AskLenNotice[], now: Date): ReadyNotice[] {
  return all.flatMap((n): ReadyNotice[] => {
    if (n.status !== "queued") return [n];
    return now.getTime() - new Date(n.at).getTime() > LOST_AFTER_MS ? [{ ...n, lost: true }] : [];
  });
}

export function noticeText(n: ReadyNotice): string {
  const passed = n.project ? `the request you passed him in «${n.project}»` : "the request you passed him";
  if (n.lost) {
    return `Len never confirmed ${passed}: «${n.request}». It may have been lost when the server restarted. Tell your owner to look at Len's chat in the project, and pass it again if it isn't there.`;
  }
  if (n.status === "failed") {
    return `Len could not do ${passed}: «${n.request}» (${n.reason ?? "the turn did not run"}). Tell your owner, and pass it again if they still want it.`;
  }
  const closing = (n.closing ?? "").trim();
  return [
    `Len finished ${passed}: «${n.request}».`,
    closing === "" ? "He left no closing message." : `His closing message:\n${closing.length > CLOSING_MAX ? `${closing.slice(0, CLOSING_MAX - 1)}…` : closing}`,
  ].join("\n\n");
}
