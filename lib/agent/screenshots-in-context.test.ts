import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";
import { SCREENSHOTS_KEPT, SCREENSHOTS_QUANTUM, applyScreenshotBudget, droppedScreenshotCount, keepRecentScreenshots, screenshotLimits, screenshotsLabel } from "./screenshots-in-context";

const img = (tag: string) => ({ mimeType: "image/jpeg", dataBase64: tag });
const results = (tags: string[], content = ""): Message => ({
  role: "user",
  content,
  functionResponses: [{ name: "view_page", response: { ok: true } }],
  images: tags.map(img),
});
/** A turn that looked `n` times, one screenshot each: the model's step and the results with the picture. */
const looks = (n: number, from = 1): Message[] => Array.from({ length: n }, (_, i): Message[] => [{ role: "assistant", content: "" }, results([String(from + i)])]).flat();
const withPixels = (messages: readonly Message[]) => messages.filter((m) => m.images?.length).map((m) => m.images![0]!.dataBase64);

describe("screenshots in the conversation", () => {
  it("the label says which image came from which call, in order", () => {
    expect(screenshotsLabel([{ tool: "view_page", images: [img("a")] }, { tool: "use_page", images: [img("b"), img("c")] }])).toBe(
      "Screenshots below, in order: image 1 from view_page; images 2–3 from use_page. Look at them yourself.",
    );
  });

  // As Claude Code (100 media items, then the oldest 21 go at once) and DeepSeek (until the provider refuses,
  // then 20 at a time): they stay where they were sent. Production, the 30 days before this: a turn that looks
  // does it 8 times at the median and 31 at most, and with a limit of 3 it rewrote the conversation in 19 of 24.
  it("how many go: none up to the limit, then the oldest in whole batches of the quantum — it only ever grows", () => {
    expect([SCREENSHOTS_KEPT, SCREENSHOTS_QUANTUM]).toEqual([40, 20]);
    expect([0, 1, 31, 40].map((n) => droppedScreenshotCount(n))).toEqual([0, 0, 0, 0]);
    expect([41, 50, 60].map((n) => droppedScreenshotCount(n))).toEqual([20, 20, 20]);
    expect([61, 80, 81].map((n) => droppedScreenshotCount(n))).toEqual([40, 40, 60]);
  });

  it("🔴 a turn that looks 31 times touches nothing it already sent", () => {
    const messages = looks(31);
    const before = structuredClone(messages);
    keepRecentScreenshots(messages);
    expect(messages).toEqual(before);
    expect(applyScreenshotBudget(before)).toEqual(before);
  });

  it("past the limit the oldest twenty lose their pixels at once; they keep their text, say they were dropped and how many they were", () => {
    const messages = looks(41);
    messages[1] = results(["1"], "Screenshots below…");
    keepRecentScreenshots(messages);
    expect(withPixels(messages)).toEqual(Array.from({ length: 21 }, (_, i) => String(21 + i)));
    expect(messages[1]!.images).toBeUndefined();
    expect(messages[1]!.screenshotsDropped).toBe(1);
    expect(messages[1]!.content).toContain("Screenshots below…");
    expect(messages[1]!.content).toContain("were dropped");
    expect(messages[41]!.screenshotsDropped).toBeUndefined();
  });

  it("after a jump the next ones pile up without touching what came before, until the next jump", () => {
    const messages = looks(41);
    keepRecentScreenshots(messages);
    const afterJump = structuredClone(messages);
    messages.push(...looks(19, 42));
    keepRecentScreenshots(messages);
    expect(messages.slice(0, afterJump.length)).toEqual(afterJump);
    // The 61st: the dropped ones still count, and twenty more go.
    messages.push(...looks(1, 61));
    keepRecentScreenshots(messages);
    expect(withPixels(messages)).toEqual(Array.from({ length: 21 }, (_, i) => String(41 + i)));
    // The note is said once, however many times the budget is applied.
    keepRecentScreenshots(messages);
    expect(messages[1]!.content.match(/were dropped/g)).toHaveLength(1);
  });

  it("a dropped one never gets its pixels back, and a batch goes whole", () => {
    // Batches of three: 42 screenshots in 14 messages. Twenty have to go; the seventh batch straddles the line.
    const messages = Array.from({ length: 14 }, (_, i): Message[] => [{ role: "assistant", content: "" }, results([`${i}a`, `${i}b`, `${i}c`])]).flat();
    const out = applyScreenshotBudget(messages);
    const dropped = out.filter((m) => m.screenshotsDropped !== undefined);
    expect(dropped).toHaveLength(7);
    expect(dropped.every((m) => m.screenshotsDropped === 3 && m.images === undefined)).toBe(true);
    expect(out.filter((m) => m.images?.length)).toHaveLength(7);
    // Applied again to its own result — what a later turn does — it changes nothing.
    expect(applyScreenshotBudget(out)).toEqual(out);
    // And the input was not touched.
    expect(messages.every((m) => m.screenshotsDropped === undefined)).toBe(true);
  });

  it("the newest batch stays whole whatever its size, and the person's own photo is never touched or counted", () => {
    const photo: Message = { role: "user", content: "mira", images: [img("foto")] };
    const messages: Message[] = [photo, ...looks(3), { role: "assistant", content: "" }, results(Array.from({ length: 45 }, (_, i) => `n${i}`))];
    keepRecentScreenshots(messages);
    expect(messages.at(-1)!.images).toHaveLength(45);
    expect(messages[0]!.images).toHaveLength(1);
    expect(messages[0]!.screenshotsDropped).toBeUndefined();
    expect(withPixels(messages.slice(1, 7))).toEqual([]);
  });

  // Review: how a provider takes a request with forty real screenshots in it was not measured, and without a
  // lever the way back was a deploy.
  it("OPENLEN_SCREENSHOTS_KEPT moves the limit (half of it goes at once); a bad value is ignored", () => {
    expect(screenshotLimits({})).toEqual({ kept: 40, quantum: 20 });
    expect(screenshotLimits({ OPENLEN_SCREENSHOTS_KEPT: "3" })).toEqual({ kept: 3, quantum: 2 });
    expect(screenshotLimits({ OPENLEN_SCREENSHOTS_KEPT: "12" })).toEqual({ kept: 12, quantum: 6 });
    expect(screenshotLimits({ OPENLEN_SCREENSHOTS_KEPT: "1" })).toEqual({ kept: 1, quantum: 1 });
    for (const bad of ["abc", "0", "-3", "1.5", ""]) expect(screenshotLimits({ OPENLEN_SCREENSHOTS_KEPT: bad })).toEqual({ kept: 40, quantum: 20 });
    const few = screenshotLimits({ OPENLEN_SCREENSHOTS_KEPT: "3" });
    expect(withPixels(applyScreenshotBudget(looks(4), few.kept, few.quantum))).toEqual(["3", "4"]);
  });

  it("their stored addresses count as they are, when the pixels are not loaded", () => {
    const stored = (n: number): Message => ({ role: "user", content: "", functionResponses: [{ name: "view_page", response: { ok: true } }], screenshots: [`https://files.example/${n}.jpg`] });
    const out = applyScreenshotBudget(Array.from({ length: 41 }, (_, i) => stored(i)));
    expect(out.filter((m) => m.screenshotsDropped === 1)).toHaveLength(20);
    expect(out.slice(0, 20).every((m) => m.screenshots === undefined)).toBe(true);
    expect(out.slice(20).every((m) => m.screenshots?.length === 1)).toBe(true);
  });

  it("A2 · keeps a short deterministic observation summary when dropping screenshots from use_page", () => {
    const messages = looks(41);
    messages[1] = {
      role: "user",
      content: "Screenshots below, in order: image 1 from use_page. Look at them yourself.",
      functionResponses: [
        {
          name: "use_page",
          response: {
            ok: true,
            visit: "Visit to / as a new visitor.\n1. click «Guardar» → clicked\n   · nothing changed\nJavaScript errors in the visit: none.",
          },
        },
      ],
      images: [img("1")],
    };
    keepRecentScreenshots(messages);
    expect(messages[1]!.content).toContain("Observed before screenshots were dropped:");
    expect(messages[1]!.content).toContain("1. click «Guardar» → clicked");
    expect(messages[1]!.content).toContain("JavaScript errors in the visit: none.");
    // Idempotent on second application.
    const once = messages[1]!.content;
    keepRecentScreenshots(messages);
    expect(messages[1]!.content).toBe(once);
  });
});
