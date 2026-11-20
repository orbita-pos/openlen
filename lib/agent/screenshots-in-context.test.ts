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

  // C5 of the Ruta 98 review: the gist keeps the facts it exists for.
  const gistOf = (visit: string): string | null => {
    const messages = looks(41);
    messages[1] = { role: "user", content: "", functionResponses: [{ name: "use_page", response: { ok: true, visit } }], images: [img("1")] };
    keepRecentScreenshots(messages);
    return /Observed before screenshots were dropped: (.*)/.exec(messages[1]!.content)?.[1] ?? null;
  };
  const GIST_CAP = 220;

  it("C5 · keeps the lines that say nothing changed, next to their step, and not the other detail", () => {
    const gist = gistOf(
      [
        "Visit to / as a new visitor.",
        "1. click «Guardar» → clicked",
        "   · nothing changed: not what is shown, not the fields, not what is saved in the browser.",
        "2. click «Más» → clicked",
        "   · the counter went from 3 to 4",
        "3. reload → reloaded",
        "   · after reloading, the page looks the same as before reloading.",
        "JavaScript errors in the visit: none.",
      ].join("\n"),
    );
    expect(gist).toBe(
      "1. click «Guardar» → clicked | nothing changed | 2. click «Más» → clicked | 3. reload → reloaded | after reloading, the page looks the same as before reloading | JavaScript errors in the visit: none.",
    );
    // A field's step says «nothing else changed» (and the suffix about what changes by itself goes with the rest).
    expect(
      gistOf(["1. type «a» into «Nombre» → typed", "   · nothing else changed: not what is shown, not the other fields, not what is saved in the browser (only what changes by itself changed)."].join("\n")),
    ).toBe("1. type «a» into «Nombre» → typed | nothing else changed");
  });

  it("🔴 C5 · the JavaScript errors line is never the part that is cut: the middle gives way to it", () => {
    const steps = Array.from({ length: 12 }, (_, i) => [`${i + 1}. click «Botón número ${i + 1}» → clicked`, "   · nothing changed: not what is shown."]).flat();
    const errors = "JavaScript errors in the visit: TypeError: cart.items is undefined.";
    const gist = gistOf(["Visit to /.", ...steps, errors].join("\n"))!;
    expect(gist.endsWith(errors)).toBe(true);
    expect(gist.startsWith("1. click «Botón número 1» → clicked | nothing changed | 2. ")).toBe(true);
    expect(gist).toContain("… | JavaScript errors");
    expect(gist.length).toBeLessThanOrEqual(GIST_CAP + 1);
  });

  it("C5 · an errors line longer than the cap is still there, from its start, inside the cap", () => {
    const long = `JavaScript errors in the visit: ${Array.from({ length: 5 }, (_, i) => `Error ${i}: ${"x".repeat(150)}`).join("; ")}.`;
    const gist = gistOf(["Visit to /.", "1. click «Guardar» → clicked", "   · nothing changed.", long].join("\n"))!;
    expect(gist.startsWith("JavaScript errors in the visit: Error 0: ")).toBe(true);
    expect(gist.length).toBeLessThanOrEqual(GIST_CAP + 1);
  });

  it("C5 · an emoji at the cut is not left half", () => {
    const errors = "JavaScript errors in the visit: none.";
    const room = GIST_CAP - errors.length - " | ".length - "…".length;
    const first = "1. click «x» → clicked";
    const step = first + "a".repeat(room - first.length - 1) + "\u{1F600}" + "b".repeat(60);
    const gist = gistOf(["Visit to /.", step, errors].join("\n"))!;
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(gist)).toBe(false);
    expect(gist.endsWith(`… | ${errors}`)).toBe(true);
  });

  it("C5 · without an errors line (view_page) the cap is the same as before", () => {
    const steps = Array.from({ length: 30 }, (_, i) => `${i + 1}. click «Botón número ${i + 1}» → clicked`);
    const gist = gistOf(steps.join("\n"))!;
    expect(gist.length).toBe(GIST_CAP + 1);
    expect(gist.endsWith("…")).toBe(true);
  });
});
