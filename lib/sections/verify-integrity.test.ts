import { describe, expect, it, vi } from "vitest";

import { sectionContentHash, verifySectionIntegrity } from "./verify-integrity";

const BODY = '<section data-sec="hero-01"><h1>Taller</h1><a href="mailto:hola@openlen.com">hola</a></section>';
const HASH = sectionContentHash(BODY);

/** What Cloudflare actually returned for the drifted footers: the mailto is
 * replaced and a decoder script is injected. */
const TRANSFORMED = BODY.replace(
  'href="mailto:hola@openlen.com"',
  'href="/cdn-cgi/l/email-protection#84ecebe8e5c4"',
) + '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>';

function section(id: string, type = "footer") {
  return { id, type, contentHash: HASH, storageUrl: `https://templates.openlen.com/sections/${id}-${HASH}.html` };
}

function fetchReturning(bodies: Record<string, string | number>): typeof fetch {
  return (async (url: string | URL) => {
    const key = String(url);
    const value = Object.entries(bodies).find(([id]) => key.includes(id))?.[1];
    if (typeof value === "number") return new Response("", { status: value });
    if (value === undefined) throw new Error("network");
    return new Response(value, { status: 200 });
  }) as typeof fetch;
}

describe("section integrity verification", () => {
  it("passes a section that serves exactly the bytes its row claims", async () => {
    const report = await verifySectionIntegrity([section("footer-01")], { fetchImpl: fetchReturning({ "footer-01": BODY }) });
    expect(report).toMatchObject({ checked: 1, ok: 1, cdnTransformed: 0, corrupt: 0, unreachable: 0 });
    expect(report.rows[0]).toMatchObject({ status: "ok", servedHash: HASH });
  });

  // The whole point: an infrastructure toggle must not read as data corruption.
  it("separates a CDN-transformed body from a genuinely corrupt one", async () => {
    const report = await verifySectionIntegrity(
      [section("footer-01"), section("footer-02")],
      { fetchImpl: fetchReturning({ "footer-01": TRANSFORMED, "footer-02": "<section>otra cosa</section>" }) },
    );

    expect(report).toMatchObject({ checked: 2, ok: 0, cdnTransformed: 1, corrupt: 1 });
    expect(report.rows.find((row) => row.id === "footer-01")).toMatchObject({ status: "cdn_transformed" });
    expect(report.rows.find((row) => row.id === "footer-02")).toMatchObject({ status: "corrupt" });
  });

  it.each([404, 500])("reports an unreachable object on HTTP %s without throwing", async (status) => {
    const report = await verifySectionIntegrity([section("footer-01")], { fetchImpl: fetchReturning({ "footer-01": status }) });
    expect(report).toMatchObject({ checked: 1, unreachable: 1 });
    expect(report.rows[0]).toMatchObject({ status: "unreachable", servedHash: null, httpStatus: status });
  });

  it("survives a transport failure", async () => {
    const report = await verifySectionIntegrity([section("footer-01")], { fetchImpl: fetchReturning({}) });
    expect(report.rows[0]).toMatchObject({ status: "unreachable", httpStatus: null });
  });

  it("checks every section exactly once regardless of concurrency", async () => {
    const sections = Array.from({ length: 25 }, (_row, index) => section(`footer-${index}`));
    const fetchImpl = vi.fn(fetchReturning(Object.fromEntries(sections.map((row) => [row.id, BODY]))));
    const report = await verifySectionIntegrity(sections, { fetchImpl: fetchImpl as never, concurrency: 8 });
    expect(report.checked).toBe(25);
    expect(fetchImpl).toHaveBeenCalledTimes(25);
  });

  it("never writes: the report carries only hashes and status", async () => {
    const report = await verifySectionIntegrity([section("footer-01")], { fetchImpl: fetchReturning({ "footer-01": TRANSFORMED }) });
    expect(JSON.stringify(report)).not.toContain("<section");
    expect(JSON.stringify(report)).not.toContain("mailto:");
  });
});
