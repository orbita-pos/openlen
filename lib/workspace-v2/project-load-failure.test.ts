import { describe, expect, it } from "vitest";
import { projectLoadFailureFromStatus } from "./project-load-failure";

describe("projectLoadFailureFromStatus", () => {
  it("un 404 es que no está: borrada o de otra cuenta (la API no distingue a propósito)", () => {
    expect(projectLoadFailureFromStatus(404)).toBe("not_found");
  });

  it("un 403 se dice igual que un 404: no es tuya", () => {
    expect(projectLoadFailureFromStatus(403)).toBe("not_found");
  });

  it("un 401 es la sesión, no la página", () => {
    expect(projectLoadFailureFromStatus(401)).toBe("signed_out");
  });

  it("un 500, un 502 o un 429 NO dicen que la página no existe: se puede reintentar", () => {
    for (const status of [500, 502, 503, 429, 408]) {
      expect(projectLoadFailureFromStatus(status)).toBe("failed");
    }
  });
});
