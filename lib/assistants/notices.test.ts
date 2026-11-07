import { describe, expect, it } from "vitest";

import { LOST_AFTER_MS, noticeText, readyNotices, type AskLenNotice } from "./notices";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("the outcome of an ask_len request, back to the assistant", () => {
  const done: AskLenNotice = { id: "n1", request: "botón más grande", status: "done", at: ago(60_000), closing: "Listo: el botón de pedir ahora es más grande." };
  const failed: AskLenNotice = { id: "n2", request: "sección de envíos", status: "failed", at: ago(60_000), reason: "no_credits" };
  const fresh: AskLenNotice = { id: "n3", request: "cambia el título", status: "queued", at: ago(60_000) };
  const stale: AskLenNotice = { id: "n4", request: "añade una galería", status: "queued", at: ago(LOST_AFTER_MS + 1) };

  it("the settled ones are ready; a queued one waits, unless it has waited too long (a restart lost it)", () => {
    expect(readyNotices([done, failed, fresh, stale], NOW).map((n) => [n.id, n.lost === true])).toEqual([
      ["n1", false],
      ["n2", false],
      ["n4", true],
    ]);
  });

  it("says how each ended, with the request and Len's closing message", () => {
    expect(noticeText(done)).toBe("Len finished the request you passed him: «botón más grande».\n\nHis closing message:\nListo: el botón de pedir ahora es más grande.");
    expect(noticeText(failed)).toContain("Len could not do the request you passed him: «sección de envíos» (no_credits).");
    expect(noticeText({ ...stale, lost: true })).toContain("Len never confirmed the request you passed him: «añade una galería»");
    expect(noticeText({ ...done, closing: "" })).toContain("He left no closing message.");
  });
});
