import { describe, expect, test } from "vitest";
import { buildAlert } from "./email";

describe("buildAlert", () => {
  test("went_down: asunto rojo, sin duración", () => {
    const a = buildAlert("went_down", "pages", 1_800_000_000_000, 1_800_000_000_000);
    expect(a.subject).toContain("🔴");
    expect(a.subject).toContain("Páginas publicadas");
    expect(a.text).toContain("status.openlen.com");
  });

  test("recovered: asunto verde con minutos caídos", () => {
    const now = 1_800_000_000_000;
    const a = buildAlert("recovered", "api", now, now - 25 * 60_000);
    expect(a.subject).toContain("🟢");
    expect(a.subject).toContain("25 min");
  });
});
