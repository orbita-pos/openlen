// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ revokeByToken: vi.fn() }));
vi.mock("@/lib/mcp/oauth/revoke", () => ({ revokeByToken: m.revokeByToken }));

import { POST } from "./route";

const form = (fields: Record<string, string>) =>
  new Request("http://x", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

beforeEach(() => m.revokeByToken.mockReset());

describe("POST /api/oauth/revoke (RFC 7009)", () => {
  it("revoca y contesta 200, exista o no (no se filtra si el token era bueno)", async () => {
    m.revokeByToken.mockResolvedValue(undefined);
    expect((await POST(form({ token: "olr_x" }))).status).toBe(200);
    expect(m.revokeByToken).toHaveBeenCalledWith("olr_x");
    expect((await POST(form({}))).status).toBe(200);
  });
});
