// @vitest-environment node
import { describe, expect, it } from "vitest";
import { errorCodeOf } from "./audit";
import { jsonResult, toolError } from "./results";

describe("el código de error de un resultado", () => {
  it("sale de «Error (code): …»; un resultado bueno no tiene", () => {
    expect(errorCodeOf(toolError("not_found", "x"))).toBe("not_found");
    expect(errorCodeOf(jsonResult({ ok: 1 }))).toBeNull();
  });
});
