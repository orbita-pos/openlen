// READ_PUBLIC_DATA (spec local 2026-11-06-asistente-propio, §4.2; phase 2B): what any visitor of the page could read —
// a GET with the publishable key (role `anon`, its RLS) through the backend's own router, against production only.
import { describe, expect, it } from "vitest";

import type { BackendProject } from "@/lib/backend/router";

import {
  checkPublicQuery,
  PUBLIC_DATA_MAX_CHARS,
  PUBLIC_DATA_MAX_ROWS,
  READ_PUBLIC_DATA,
  READ_PUBLIC_DATA_DECLARATION,
  readPublicData,
  type PublicReadDeps,
} from "./read-public-data";

const TABLES = [
  { name: "huecos", columns: [{ name: "dia", type: "date" }, { name: "hora", type: "time without time zone" }] },
  { name: "precios", columns: [{ name: "producto", type: "text" }] },
];
const PROJECT = { ref: "abc123", publishableKey: "sb_publishable_xyz", secretKeyHash: "h", environment: "live" } as unknown as BackendProject;

function deps(o: { live?: boolean; status?: number; body?: string } = {}) {
  const seen: Request[] = [];
  const asked: string[] = [];
  const d: PublicReadDeps = {
    liveProject: async (projectId) => (asked.push(projectId), o.live === false ? null : { project: PROJECT, host: "abc123.openlen.app" }),
    serve: async (req) => (seen.push(req), new Response(o.body ?? '[{"dia":"2026-11-14","hora":"17:00"}]', { status: o.status ?? 200 })),
  };
  return { d, seen, asked };
}
const text = (r: { response: Record<string, unknown> }) => JSON.stringify(r.response);

describe("read_public_data", () => {
  it("is declared with one parameter, the PostgREST path", () => {
    expect(READ_PUBLIC_DATA).toBe("read_public_data");
    expect(READ_PUBLIC_DATA_DECLARATION.name).toBe(READ_PUBLIC_DATA);
    expect((READ_PUBLIC_DATA_DECLARATION.parameters as unknown as { required: string[] }).required).toEqual(["query"]);
  });

  it("reads as anon: a GET with the publishable key, never an Authorization, against production", async () => {
    const s = deps();
    const r = await readPublicData("p1", "huecos?select=dia,hora&dia=eq.2026-11-14&order=hora", TABLES, s.d);
    expect(s.asked).toEqual(["p1"]);
    const req = s.seen[0]!;
    expect(req.method).toBe("GET");
    expect(req.headers.get("apikey")).toBe("sb_publishable_xyz");
    expect(req.headers.get("authorization")).toBeNull();
    const url = new URL(req.url);
    expect(url.host).toBe("abc123.openlen.app");
    expect(url.pathname).toBe("/rest/v1/huecos");
    expect(url.searchParams.get("dia")).toBe("eq.2026-11-14");
    expect(r.response.ok).toBe(true);
    expect(text(r)).toContain("17:00");
  });

  it("🔴 refuses what isn't one of its public tables: another table, rpc/…, a second segment, ; or a newline", () => {
    for (const q of ["reservas?select=*", "rpc/borrar_todo", "huecos/extra", "huecos?select=*;drop table huecos", "huecos?select=*\nX-Evil: 1", "../auth/v1/users", "huecos#x", ""]) {
      expect(checkPublicQuery(q, TABLES).ok, q).toBe(false);
    }
    expect(checkPublicQuery("/rest/v1/precios?select=producto", TABLES)).toMatchObject({ ok: true, path: "precios" });
  });

  it("🔴 at most 50 rows: adds limit, lowers a bigger one, drops an apikey the model wrote", () => {
    const a = checkPublicQuery("huecos?select=dia", TABLES);
    const b = checkPublicQuery("huecos?select=dia&limit=10000&apikey=sb_secret_x", TABLES);
    const c = checkPublicQuery("huecos?limit=5", TABLES);
    if (!a.ok || !b.ok || !c.ok) throw new Error("refused");
    expect(new URLSearchParams(a.search).get("limit")).toBe(String(PUBLIC_DATA_MAX_ROWS));
    expect(new URLSearchParams(b.search).get("limit")).toBe("50");
    expect(new URLSearchParams(b.search).get("apikey")).toBeNull();
    expect(new URLSearchParams(c.search).get("limit")).toBe("5");
  });

  it("🔴 a huge answer is cut at 8000 characters and says so", async () => {
    const s = deps({ body: JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ dia: "2026-11-14", hora: `${i}` }))) });
    const r = await readPublicData("p1", "huecos", TABLES, s.d);
    const out = String(Object.values(r.response).find((v) => typeof v === "string" && v.includes("2026")));
    expect(out.length).toBeLessThanOrEqual(PUBLIC_DATA_MAX_CHARS + 20);
    expect(out).toContain("(truncated)");
  });

  it("no production yet: says the data isn't published", async () => {
    const r = await readPublicData("p1", "huecos", TABLES, deps({ live: false }).d);
    expect(r.response.ok).toBe(false);
    expect(text(r)).toMatch(/not published/i);
  });

  it("a PostgREST error comes back as the tool's error, with its message", async () => {
    const r = await readPublicData("p1", "huecos?select=nope", TABLES, deps({ status: 400, body: '{"code":"42703","message":"column huecos.nope does not exist"}' }).d);
    expect(r.response.ok).toBe(false);
    expect(text(r)).toContain("column huecos.nope does not exist");
  });
});
