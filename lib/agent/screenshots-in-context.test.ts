import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";
import { keepRecentScreenshots, screenshotsLabel } from "./screenshots-in-context";

const img = (tag: string) => ({ mimeType: "image/jpeg", dataBase64: tag });
const results = (tags: string[], content = ""): Message => ({
  role: "user",
  content,
  functionResponses: [{ name: "view_page", response: { ok: true } }],
  images: tags.map(img),
});

describe("screenshots in the turn's context", () => {
  it("the label says which image came from which call, in order", () => {
    expect(screenshotsLabel([{ tool: "view_page", images: [img("a")] }, { tool: "use_page", images: [img("b"), img("c")] }])).toBe(
      "Screenshots below, in order: image 1 from view_page; images 2–3 from use_page. Look at them yourself.",
    );
  });

  it("🔴 only the newest screenshots keep their pixels; older batches keep their text and say they were dropped", () => {
    const messages: Message[] = [results(["1"], "Screenshots below…"), { role: "assistant", content: "" }, results(["2", "3"]), { role: "assistant", content: "" }, results(["4"])];
    keepRecentScreenshots(messages, 3);
    expect(messages[4]!.images?.map((i) => i.dataBase64)).toEqual(["4"]);
    expect(messages[2]!.images?.map((i) => i.dataBase64)).toEqual(["2", "3"]);
    expect(messages[0]!.images).toBeUndefined();
    expect(messages[0]!.content).toContain("Screenshots below…");
    expect(messages[0]!.content).toContain("were dropped");
  });

  it("the newest batch stays whole even above the limit, and the user's own photo is never touched", () => {
    const photo: Message = { role: "user", content: "mira", images: [img("foto")] };
    const messages: Message[] = [photo, results(["1"]), { role: "assistant", content: "" }, results(["2", "3", "4", "5"])];
    keepRecentScreenshots(messages, 3);
    expect(messages[3]!.images).toHaveLength(4);
    expect(messages[1]!.images).toBeUndefined();
    expect(messages[0]!.images).toHaveLength(1);
  });
});
