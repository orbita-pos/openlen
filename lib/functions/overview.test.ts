// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DeploymentRecord } from "./deployments";
import { functionsOverview, type OverviewDeps } from "./overview";

const dep = (environment: "draft" | "live", functions: { name: string; verifyJwt: boolean }[]): DeploymentRecord => ({
  projectId: "p1",
  environment,
  catalog: "2026-11",
  hash: "h",
  functions,
  deployedAt: new Date(),
});

function deps(o: Partial<OverviewDeps> = {}): OverviewDeps {
  return {
    deployment: async (_p, env) =>
      env === "draft" ? dep("draft", [{ name: "checkout", verifyJwt: true }, { name: "stripe-webhook", verifyJwt: false }]) : dep("live", [{ name: "stripe-webhook", verifyJwt: false }]),
    monthCalls: async () => 8000,
    plan: async () => "free",
    blocked: async () => false,
    recentErrors: async () => [
      { projectId: "p1", environment: "live", name: "stripe-webhook", status: 500, errorCode: "WORKER_ERROR", ms: 10, logs: [], error: "TypeError: x", startedAt: new Date("2026-10-12T10:00:00Z") },
    ],
    now: () => new Date("2026-10-12T12:00:00Z"),
    ...o,
  };
}

describe("functionsOverview", () => {
  it("cada función con dónde está, el uso del mes contra la cuota de SU plan, y los errores", async () => {
    expect(await functionsOverview("p1", deps())).toEqual({
      available: true,
      blocked: false,
      functions: [
        { name: "checkout", draft: true, live: false, verifyJwt: true },
        { name: "stripe-webhook", draft: true, live: true, verifyJwt: false },
      ],
      usage: { month: "2026-10", calls: 8000, quota: 10_000 },
      errors: [{ environment: "live", name: "stripe-webhook", status: 500, errorCode: "WORKER_ERROR", error: "TypeError: x", startedAt: "2026-10-12T10:00:00.000Z" }],
    });
  });

  it("sin nada desplegado, sin funciones; de pago, su cuota; con la marca, lo dice", async () => {
    const r = await functionsOverview("p1", deps({ deployment: async () => null, plan: async () => "pro", blocked: async () => true, recentErrors: async () => [] }));
    expect(r).toMatchObject({ blocked: true, functions: [], usage: { quota: 100_000 }, errors: [] });
  });
});
