// @vitest-environment node
// Lo que se registra en el SDK: `_meta` sólo donde se declara.
import { describe, expect, it } from "vitest";
import { registerOpenLenTools } from "./index";

describe("registrar las herramientas", () => {
  it("publicar y despublicar piden la confirmación de la persona en Claude; las demás no llevan _meta", () => {
    const calls: { name: string; config: Record<string, unknown> }[] = [];
    registerOpenLenTools({ registerTool: (name: string, config: Record<string, unknown>) => void calls.push({ name, config }) } as never);
    const of = (n: string) => calls.find((c) => c.name === n)!.config;
    for (const n of ["publish", "unpublish"]) expect(of(n)._meta).toEqual({ "anthropic/requiresUserInteraction": true });
    expect(of("read_file")).not.toHaveProperty("_meta");
  });
});
