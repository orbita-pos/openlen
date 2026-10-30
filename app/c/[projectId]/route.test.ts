// @vitest-environment node
// The beacon route with Len Watch's report: it goes to the ingester (unless Len Watch is off or a
// bot sent it), and the analytics beacons keep landing in pageEvents as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ingestWatchReport, values } = vi.hoisted(() => ({
  ingestWatchReport: vi.fn(async () => undefined),
  values: vi.fn(async () => undefined),
}));

vi.mock("@/lib/len-watch/ingest", () => ({ ingestWatchReport }));
vi.mock("@/lib/publish/request-origin", () => ({
  subdomainOfProject: async () => null,
  checkSubdomainOrigin: async () => ({ kind: "match" }),
  publishedBaseHosts: () => [],
  resolveCustomDomainSub: async () => null,
}));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return { schema: s, db: { insert: () => ({ values }) } };
});

const { POST } = await import("./route");

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function beacon(body: unknown, ua = BROWSER, ip = "203.0.113.7") {
  return POST(new Request("https://holi.openlen.app/c/p1", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": ua, "x-forwarded-for": ip } }), {
    params: Promise.resolve({ projectId: "p1" }),
  });
}

beforeEach(() => {
  ingestWatchReport.mockClear();
  values.mockClear();
});

afterEach(() => {
  delete process.env.OPENLEN_WATCH;
});

describe("POST /c/[projectId] with a Len Watch report", () => {
  it("hands the scrubbed report to the ingester and answers 204", async () => {
    const res = await beacon({ t: "f", m: "boom", p: "menu" });
    expect(res.status).toBe(204);
    await vi.waitFor(() => expect(ingestWatchReport).toHaveBeenCalledWith("p1", { message: "boom", file: null, line: null, col: null, page: "menu" }));
    expect(values).not.toHaveBeenCalled();
  });

  it("does nothing with Len Watch off", async () => {
    process.env.OPENLEN_WATCH = "0";
    expect((await beacon({ t: "f", m: "boom" }, BROWSER, "203.0.113.8")).status).toBe(204);
    await new Promise((r) => setTimeout(r, 20));
    expect(ingestWatchReport).not.toHaveBeenCalled();
  });

  it("ignores a bot", async () => {
    expect((await beacon({ t: "f", m: "boom" }, "Googlebot/2.1 (+http://www.google.com/bot.html)", "203.0.113.9")).status).toBe(204);
    await new Promise((r) => setTimeout(r, 20));
    expect(ingestWatchReport).not.toHaveBeenCalled();
  });

  it("a page view still lands in pageEvents", async () => {
    expect((await beacon({ t: "v" }, BROWSER, "203.0.113.10")).status).toBe(204);
    expect(values).toHaveBeenCalledTimes(1);
    expect(ingestWatchReport).not.toHaveBeenCalled();
  });
});
