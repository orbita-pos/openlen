// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkToolAllowed } from "./plan-policy";
import type { ToolResult } from "./results";

const caller = (scopes: string[]) => ({ userId: "u1", tokenId: "t1", scopes: new Set(scopes as never[]), projectId: null });
const text = (r: ToolResult | null) => (r?.content[0] as { type: "text"; text: string } | undefined)?.text ?? "";

describe("qué puede cada conexión", () => {
  it("leer vale en el plan gratis", async () => {
    expect(await checkToolAllowed(caller(["projects:read"]), "read_file", async () => "free")).toBeNull();
  });
  it("escribir pide projects:write Y plan de pago", async () => {
    expect(text(await checkToolAllowed(caller(["projects:read"]), "write_file", async () => "pro"))).toContain("insufficient_scope");
    expect(text(await checkToolAllowed(caller(["projects:write"]), "write_file", async () => "free"))).toContain("plan_required");
    expect(await checkToolAllowed(caller(["projects:write"]), "write_file", async () => "pro")).toBeNull();
  });
  it("publicar y despublicar piden el permiso publish", async () => {
    expect(text(await checkToolAllowed(caller(["projects:write"]), "publish", async () => "max"))).toContain("insufficient_scope");
    expect(await checkToolAllowed(caller(["publish"]), "unpublish", async () => "max")).toBeNull();
  });
});
