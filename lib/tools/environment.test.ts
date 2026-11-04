// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { isInstalledToolOrigin } from "./environment";

const LABEL = "lienzo-00112233445566778899aabbccddeeff";
const row = (over: Record<string, unknown> = {}) => ({ projectId: "p1", enabled: true, removedAt: null, ...over });

describe("isInstalledToolOrigin", () => {
  const lookup = (r: unknown) => vi.fn(async () => r as never);
  const ask = (origin: string | null, r: unknown) =>
    isInstalledToolOrigin({ origin, referer: null, lienzoLabel: "lienzo-ffffffffffffffffffffffffffffffff", projectId: "p1" }, lookup(r));

  it("its own installed tool: yes", async () => {
    expect(await ask(`https://${LABEL}.openlen.app`, row())).toBe(true);
  });
  it("another project's tool, switched off or removed: no", async () => {
    expect(await ask(`https://${LABEL}.openlen.app`, row({ projectId: "p2" }))).toBe(false);
    expect(await ask(`https://${LABEL}.openlen.app`, row({ enabled: false }))).toBe(false);
    expect(await ask(`https://${LABEL}.openlen.app`, row({ removedAt: new Date() }))).toBe(false);
    expect(await ask(`https://${LABEL}.openlen.app`, null)).toBe(false);
  });
  it("not a lienzo label, or this project's own canvas: no lookup at all", async () => {
    const l = lookup(row());
    expect(await isInstalledToolOrigin({ origin: "https://openlen.com", referer: null, lienzoLabel: "x", projectId: "p1" }, l)).toBe(false);
    expect(await isInstalledToolOrigin({ origin: `https://${LABEL}.openlen.app`, referer: null, lienzoLabel: LABEL, projectId: "p1" }, l)).toBe(false);
    expect(l).not.toHaveBeenCalled();
  });
});
