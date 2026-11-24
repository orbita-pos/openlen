// @vitest-environment node
//
// The same rule as carriesConnectorResults, asked IN Postgres (spec local 2026-11-24-servidor-de-google-calendar, §5.8:
// «nunca llega a la máquina de desarrollo»): the fetchers ask the box first and never bring a conversation that carries a
// connector's results. Run against a real Postgres (PGlite), on jsonb as the chat rows store it.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { connectorCallsIn } from "./personal-data";

let p: PGlite;
beforeAll(async () => {
  p = new PGlite();
  await p.waitReady;
}, 60_000);

async function carries(value: unknown): Promise<boolean> {
  const r = await p.query<{ yes: boolean }>(`select ${connectorCallsIn("$1::jsonb")} as yes`, [JSON.stringify(value)]);
  return r.rows[0]!.yes;
}

describe("connectorCallsIn", () => {
  it("🔴 a stored call to a connector's tool or a resource read: yes", async () => {
    expect(await carries([{ role: "assistant", content: "", functionCalls: [{ name: "mcp__google-calendar__list_events", args: {} }] }])).toBe(true);
    expect(await carries([{ role: "assistant", content: "", functionCalls: [{ name: "read_mcp_resource", args: {} }] }])).toBe(true);
    expect(await carries([{ tool: "mcp__notion__search", ok: true }])).toBe(true);
  });

  it("🔴 «mcp__» said in a message, or Len's own tools: no", async () => {
    expect(await carries([{ role: "user", content: "¿por qué no veo mcp__google-calendar__list_events?" }])).toBe(false);
    expect(await carries([{ role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: "/index.html" } }] }])).toBe(false);
    expect(await carries([{ role: "user", content: '"name": "mcp__x"' }])).toBe(false);
  });
});
