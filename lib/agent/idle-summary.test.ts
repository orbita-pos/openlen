import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { isCompactionMark } from "./compaction/mark";
import { COMPACTION_INSTRUCTION, SUMMARY_OPEN_TAG } from "./compaction/summary-prompt";
import {
  IDLE_SUMMARY_MAX_ARMED,
  armIdleSummary,
  armedIdleSummaries,
  cancelIdleSummary,
  collectSummary,
  idleSummaryDeadlineMs,
  idleSummaryDelayMs,
  idleSummaryEnabled,
  idleSummaryMinTokens,
  runIdleSummary,
  type IdleSummaryJob,
  type IdleUsage,
  type PendingIdleSummary,
} from "./idle-summary";

// THE IDLE SUMMARY (spec local 2026-11-13-conversar-todo-el-mes, piece B): a long conversation left idle is
// summarized while the provider still has it cached; a turn that comes back cold starts from that summary.

const USAGE: IdleUsage = { inputTokens: 12_000, cachedTokens: 12_000, outputTokens: 60 };
const SUMMARY = "## Primary Request and Intent\n- read six files";

/** system, manual, a turn that read six files of 7.000 characters, and a short exchange: ~12.000 tokens. */
function conversation(): Message[] {
  const reads = Array.from({ length: 6 }, (_, k): Message[] => [
    { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: `/src/f${k}.ts` } }] },
    { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: `${k}:`.padEnd(7_000, "x") } }] },
  ]).flat();
  return [
    { role: "system", content: "s" },
    { role: "user", content: "manual" },
    { role: "user", content: "lee los ficheros" },
    ...reads,
    { role: "assistant", content: "Leídos." },
    { role: "user", content: "gracias" },
    { role: "assistant", content: "De nada." },
  ];
}

type Mocked = IdleSummaryJob & {
  stillCurrent: ReturnType<typeof vi.fn<IdleSummaryJob["stillCurrent"]>>;
  canAfford: ReturnType<typeof vi.fn<IdleSummaryJob["canAfford"]>>;
  summarize: ReturnType<typeof vi.fn<IdleSummaryJob["summarize"]>>;
  charge: ReturnType<typeof vi.fn<IdleSummaryJob["charge"]>>;
  save: ReturnType<typeof vi.fn<IdleSummaryJob["save"]>>;
};

function jobFor(key = "p1:", over: Partial<IdleSummaryJob> = {}): Mocked {
  return {
    key,
    messages: conversation(),
    firstIndex: 2,
    transcriptLength: 13,
    minTokens: 1_000,
    stillCurrent: vi.fn<IdleSummaryJob["stillCurrent"]>(async () => true),
    canAfford: vi.fn<IdleSummaryJob["canAfford"]>(async () => true),
    summarize: vi.fn<IdleSummaryJob["summarize"]>(async () => ({ text: SUMMARY, usage: USAGE })),
    charge: vi.fn<IdleSummaryJob["charge"]>(async () => {}),
    save: vi.fn<IdleSummaryJob["save"]>(async () => {}),
    ...over,
  } as Mocked;
}

const never = () => new AbortController().signal;

describe("runIdleSummary", () => {
  it("summarizes and saves a mark the history can start from", async () => {
    const job = jobFor();
    expect(await runIdleSummary(job, never(), () => new Date("2026-11-13T10:00:00Z"))).toBe("saved");
    const pending: PendingIdleSummary = job.save.mock.calls[0]![0];
    expect(pending.writtenAt).toBe("2026-11-13T10:00:00.000Z");
    expect(isCompactionMark(pending.mark)).toBe(true);
    expect(pending.mark).toMatchObject({ trigger: "idle", fromTranscript: 13 });
    // No skill comes back behind it, so the mark names none: the history then forgets what the row had loaded.
    expect(pending.mark).not.toHaveProperty("skills");
    expect(pending.mark.messages[0]!.content).toContain(SUMMARY_OPEN_TAG);
    expect(pending.mark.messages[0]!.content).toContain(SUMMARY);
    expect(pending.mark.postTokens).toBeLessThan(pending.mark.preTokens);
    // The tail it keeps is the end of the conversation, as it was.
    expect(pending.mark.messages.at(-1)).toEqual({ role: "assistant", content: "De nada." });
  });

  it("the request starts with the conversation as it was sent and ends with the summary instruction", async () => {
    const job = jobFor();
    await runIdleSummary(job, never());
    const request = job.summarize.mock.calls[0]![0];
    expect(request.length).toBeGreaterThan(8);
    request.slice(0, -1).forEach((m, i) => expect(m).toBe(job.messages[i]));
    expect(request.at(-1)).toEqual({ role: "user", content: COMPACTION_INSTRUCTION });
  });

  it("one call, charged with what the provider reported", async () => {
    const job = jobFor();
    await runIdleSummary(job, never());
    expect(job.summarize).toHaveBeenCalledTimes(1);
    expect(job.charge).toHaveBeenCalledTimes(1);
    expect(job.charge).toHaveBeenCalledWith(USAGE);
  });

  // Claude Code checks again when its timer fires («prefix_changed», «newer_request»): the conversation armed
  // may no longer be the one that is there.
  it("the conversation moved on, was archived or is gone when the timer fires: nothing is asked, nothing is charged", async () => {
    const job = jobFor();
    job.stillCurrent.mockResolvedValueOnce(false);
    expect(await runIdleSummary(job, never())).toBe("stale");
    expect(job.canAfford).not.toHaveBeenCalled();
    expect(job.summarize).not.toHaveBeenCalled();
    expect(job.charge).not.toHaveBeenCalled();
    expect(job.save).not.toHaveBeenCalled();
  });

  it("a short conversation is not even looked up", async () => {
    const job = jobFor("p1:", { minTokens: 10_000_000 });
    expect(await runIdleSummary(job, never())).toBe("small");
    expect(job.stillCurrent).not.toHaveBeenCalled();
  });

  it("a conversation under the minimum is not summarized", async () => {
    const job = jobFor("p1:", { minTokens: 10_000_000 });
    expect(await runIdleSummary(job, never())).toBe("small");
    expect(job.canAfford).not.toHaveBeenCalled();
    expect(job.summarize).not.toHaveBeenCalled();
  });

  it("the owner cannot afford it: no call", async () => {
    const job = jobFor();
    job.canAfford.mockResolvedValueOnce(false);
    expect(await runIdleSummary(job, never())).toBe("unaffordable");
    expect(job.canAfford.mock.calls[0]![0]).toBeGreaterThan(10_000);
    expect(job.summarize).not.toHaveBeenCalled();
    expect(job.save).not.toHaveBeenCalled();
  });

  it("no usable summary: nothing is saved, and the call is still charged", async () => {
    const job = jobFor();
    job.summarize.mockResolvedValueOnce({ text: null, usage: USAGE });
    expect(await runIdleSummary(job, never())).toBe("no_summary");
    expect(job.save).not.toHaveBeenCalled();
    expect(job.charge).toHaveBeenCalledWith(USAGE);
  });

  it("a summary that does not shrink the conversation is not saved", async () => {
    const job = jobFor();
    job.summarize.mockResolvedValueOnce({ text: "y".repeat(100_000), usage: USAGE });
    expect(await runIdleSummary(job, never())).toBe("no_summary");
    expect(job.save).not.toHaveBeenCalled();
    expect(job.summarize).toHaveBeenCalledTimes(1);
  });

  it("a call that failed and reported nothing is not charged", async () => {
    const job = jobFor();
    job.summarize.mockResolvedValueOnce({ text: null, usage: null });
    expect(await runIdleSummary(job, never())).toBe("no_summary");
    expect(job.charge).not.toHaveBeenCalled();
  });

  it("already cancelled: nothing runs", async () => {
    const job = jobFor();
    const controller = new AbortController();
    controller.abort();
    expect(await runIdleSummary(job, controller.signal)).toBe("cancelled");
    expect(job.summarize).not.toHaveBeenCalled();
  });

  it("a charge that fails does not lose the summary", async () => {
    const job = jobFor();
    job.charge.mockRejectedValueOnce(new Error("the ledger is away"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runIdleSummary(job, never())).toBe("saved");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("armIdleSummary", () => {
  const keys: string[] = [];
  const arm = (job: IdleSummaryJob, delayMs: number, opts?: Parameters<typeof armIdleSummary>[2]) => {
    keys.push(job.key);
    return armIdleSummary(job, delayMs, opts);
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const key of keys.splice(0)) cancelIdleSummary(key);
    vi.useRealTimers();
  });

  it("fires once after the delay, and the conversation stops waiting when it is done", async () => {
    const job = jobFor();
    expect(arm(job, 58.5 * 60_000)).toBe(true);
    expect(armedIdleSummaries()).toBe(1);
    await vi.advanceTimersByTimeAsync(58.5 * 60_000 - 1);
    expect(job.summarize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(job.summarize).toHaveBeenCalledTimes(1);
    expect(job.save).toHaveBeenCalledTimes(1);
    expect(armedIdleSummaries()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 3_600_000);
    expect(job.summarize).toHaveBeenCalledTimes(1);
  });

  it("cancelled before it fires: nothing runs", async () => {
    const job = jobFor();
    arm(job, 1_000);
    cancelIdleSummary(job.key);
    expect(armedIdleSummaries()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(job.summarize).not.toHaveBeenCalled();
  });

  it("cancel while the summary is being written: the call is aborted and nothing is saved", async () => {
    let seen: AbortSignal | null = null;
    const job = jobFor("p1:", {
      summarize: vi.fn<IdleSummaryJob["summarize"]>(
        (_request, signal) =>
          new Promise((resolve) => {
            seen = signal;
            signal.addEventListener("abort", () => resolve({ text: SUMMARY, usage: null }));
          }),
      ),
    });
    arm(job, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(job.summarize).toHaveBeenCalledTimes(1);
    cancelIdleSummary(job.key);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen!.aborted).toBe(true);
    expect(job.save).not.toHaveBeenCalled();
    expect(armedIdleSummaries()).toBe(0);
  });

  it("arming the same conversation again replaces the first timer", async () => {
    const first = jobFor("p1:");
    const second = jobFor("p1:");
    arm(first, 1_000);
    arm(second, 3_000);
    expect(armedIdleSummaries()).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(first.summarize).not.toHaveBeenCalled();
    expect(second.summarize).toHaveBeenCalledTimes(1);
  });

  it("two conversations wait apart: the project's chat and its assistant's", async () => {
    const chat = jobFor("p1:");
    const assistant = jobFor("p1:assistant:a1");
    arm(chat, 1_000);
    arm(assistant, 2_000);
    expect(armedIdleSummaries()).toBe(2);
    cancelIdleSummary("p1:");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(chat.summarize).not.toHaveBeenCalled();
    expect(assistant.summarize).toHaveBeenCalledTimes(1);
  });

  it(`past ${IDLE_SUMMARY_MAX_ARMED} waiting conversations a new one is not armed`, () => {
    for (let i = 0; i < IDLE_SUMMARY_MAX_ARMED; i++) expect(arm(jobFor(`p${i}:`), 60_000)).toBe(true);
    expect(arm(jobFor("one-too-many:"), 60_000)).toBe(false);
    expect(armedIdleSummaries()).toBe(IDLE_SUMMARY_MAX_ARMED);
    // One that was already waiting can still be armed again.
    expect(arm(jobFor("p0:"), 60_000)).toBe(true);
  });

  // Claude Code's «lapsed»: fired more than a minute late (the process slept or was busy), the cache may be gone.
  it("a timer that fires more than a minute late does nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let clock = 1_000_000;
    const job = jobFor();
    arm(job, 1_000, { now: () => clock });
    clock += 1_000 + 60_001;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(job.stillCurrent).not.toHaveBeenCalled();
    expect(job.summarize).not.toHaveBeenCalled();
    expect(armedIdleSummaries()).toBe(0);
    // The journal says why there is no summary.
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[idle-summary] p1:: fired 60 s late — nothing was asked"]);
    warn.mockRestore();
  });

  it("a minute late or less still runs", async () => {
    let clock = 1_000_000;
    const job = jobFor();
    arm(job, 1_000, { now: () => clock });
    clock += 1_000 + 60_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(job.summarize).toHaveBeenCalledTimes(1);
  });

  it("a call that is still not answered at its deadline is abandoned, and the conversation stops waiting", async () => {
    let seen: AbortSignal | null = null;
    const job = jobFor("p1:", {
      summarize: vi.fn<IdleSummaryJob["summarize"]>(
        (_request, signal) =>
          new Promise((resolve) => {
            seen = signal;
            signal.addEventListener("abort", () => resolve({ text: null, usage: null }));
          }),
      ),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    arm(job, 1_000, { deadlineMs: 5_000 });
    await vi.advanceTimersByTimeAsync(1_000 + 4_999);
    expect(seen!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen!.aborted).toBe(true);
    expect(job.save).not.toHaveBeenCalled();
    expect(job.charge).not.toHaveBeenCalled();
    expect(armedIdleSummaries()).toBe(0);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[idle-summary] p1:: not answered in 5 s — abandoned"]);
    warn.mockRestore();
  });

  it("a newer turn that arrives while the call is running clears its deadline too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const job = jobFor("p1:", {
      summarize: vi.fn<IdleSummaryJob["summarize"]>((_request, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ text: null, usage: null })))),
    });
    arm(job, 1_000, { deadlineMs: 5_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    cancelIdleSummary("p1:");
    await vi.advanceTimersByTimeAsync(60_000);
    // Nothing was abandoned at a deadline: the newer turn had already cancelled it.
    expect(warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    warn.mockRestore();
  });

  it("a call answered in time is not cut by its deadline", async () => {
    const job = jobFor();
    arm(job, 1_000, { deadlineMs: 5_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(job.save).toHaveBeenCalledTimes(1);
  });

  it("a task that throws is logged and does not escape the timer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const job = jobFor("p1:", { canAfford: vi.fn<IdleSummaryJob["canAfford"]>(async () => Promise.reject(new Error("the database is away"))) });
    arm(job, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith("[idle-summary]"))).toBe(true);
    expect(armedIdleSummaries()).toBe(0);
    warn.mockRestore();
  });
});

describe("the idle summary's settings", () => {
  it("the call has until the turn would be cold to answer: 6.5 minutes by default", () => {
    expect(idleSummaryDeadlineMs({})).toBe(390_000);
    expect(idleSummaryDeadlineMs({ OPENLEN_COLD_AFTER_MIN: "30" })).toBe(180_000);
  });

  it("fires at 90 % of the cold threshold: 58.5 minutes by default", () => {
    expect(idleSummaryDelayMs({})).toBe(3_510_000);
    expect(idleSummaryDelayMs({ OPENLEN_COLD_AFTER_MIN: "30" })).toBe(1_620_000);
  });

  it("100.000 tokens by default; OPENLEN_IDLE_SUMMARY_MIN_TOKENS moves it and a bad value is ignored", () => {
    expect(idleSummaryMinTokens({})).toBe(100_000);
    expect(idleSummaryMinTokens({ OPENLEN_IDLE_SUMMARY_MIN_TOKENS: "40000" })).toBe(40_000);
    for (const bad of ["abc", "0", "-1", "1.5", ""]) expect(idleSummaryMinTokens({ OPENLEN_IDLE_SUMMARY_MIN_TOKENS: bad })).toBe(100_000);
  });

  it("only the literal 0 turns it off", () => {
    expect(idleSummaryEnabled({})).toBe(true);
    expect(idleSummaryEnabled({ OPENLEN_IDLE_SUMMARY: "0" })).toBe(false);
    expect(idleSummaryEnabled({ OPENLEN_IDLE_SUMMARY: "false" })).toBe(true);
  });
});

// One model call, read to the end: the same rule the loop has for a summary it asks for itself
// (`summarizeWithModel`) — it is a summary only if the model called no tool and finished its answer.
describe("collectSummary", () => {
  const stream = (...events: StreamEvent[]) => (async function* () { for (const ev of events) yield ev; })();
  const reported: StreamEvent = { type: "usage", inputTokens: 200_000, outputTokens: 3_000, cachedTokens: 199_000, thinkingTokens: 400 };
  const end: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
  const usage = { inputTokens: 200_000, cachedTokens: 199_000, outputTokens: 3_000 };

  it("gathers the text and what the provider reported", async () => {
    expect(await collectSummary(stream({ type: "reasoning", text: "…" }, { type: "text_delta", text: "## Primary" }, { type: "text_delta", text: " Request" }, reported, end))).toEqual({ text: "## Primary Request", usage });
  });

  it("an answer that calls a tool is not a summary, and what it cost is still reported", async () => {
    expect(await collectSummary(stream({ type: "text_delta", text: "let me read" }, { type: "function_call", name: "Read", args: { file_path: "/a" } }, reported, end))).toEqual({ text: null, usage });
  });

  it("an answer that was cut or failed is not a summary", async () => {
    expect(await collectSummary(stream({ type: "text_delta", text: "## Pri" }, reported, { type: "done", stopReason: { kind: "max_tokens" } }))).toEqual({ text: null, usage });
    expect((await collectSummary(stream({ type: "text_delta", text: "## Pri" }, { type: "done", stopReason: { kind: "error", code: "provider_error", message: "x" } as never }))).text).toBeNull();
  });

  it("no text, or a stream that never said it was done: no summary", async () => {
    expect((await collectSummary(stream(reported, end))).text).toBeNull();
    expect((await collectSummary(stream({ type: "text_delta", text: "## Primary" }, reported))).text).toBeNull();
  });

  it("a stream that throws: no summary and nothing to charge", async () => {
    const broken = (async function* (): AsyncGenerator<StreamEvent> {
      yield { type: "text_delta", text: "## Pri" };
      throw new Error("the network went away");
    })();
    expect(await collectSummary(broken)).toEqual({ text: null, usage: null });
  });
});
