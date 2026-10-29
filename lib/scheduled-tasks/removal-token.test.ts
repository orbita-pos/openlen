// «Quitar esta tarea» from the email (spec §7.8): a link signed like Len's email address, so only
// whoever got the email can remove that task.
import { describe, expect, it } from "vitest";

import { removalToken, removeUrl, verifyRemovalToken } from "./removal-token";

const env = { AUTH_SECRET: "s3cret" };

describe("removal token", () => {
  it("verifies its own token and nothing else", () => {
    const t = removalToken("schedule-1", env)!;
    expect(t).toMatch(/^[0-9a-f]{24}$/);
    expect(verifyRemovalToken("schedule-1", t, env)).toBe(true);
    expect(verifyRemovalToken("schedule-2", t, env)).toBe(false);
    expect(verifyRemovalToken("schedule-1", t.replace(/.$/, (c) => (c === "0" ? "1" : "0")), env)).toBe(false);
    expect(verifyRemovalToken("schedule-1", "", env)).toBe(false);
  });

  it("without a secret there is no token and nothing verifies", () => {
    expect(removalToken("schedule-1", {})).toBeNull();
    expect(verifyRemovalToken("schedule-1", "abc", {})).toBe(false);
  });

  it("builds the localized page's URL", () => {
    expect(removeUrl({ siteUrl: "https://openlen.com", locale: "es", taskId: "schedule-1" }, env)).toBe(
      `https://openlen.com/es/scheduled-tasks/remove?task=schedule-1&token=${removalToken("schedule-1", env)}`,
    );
  });
});
