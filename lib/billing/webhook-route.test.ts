import { createHmac } from "node:crypto";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mock ONLY the DB-touching reconcile so we exercise the real signature
// verification + event dispatch end-to-end through the actual route handler.
const { applySubscriptionStateMock } = vi.hoisted(() => ({
  applySubscriptionStateMock: vi.fn(),
}));

vi.mock("@/lib/billing/polar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/polar")>();
  return { ...actual, applySubscriptionState: applySubscriptionStateMock };
});

// Mock the dedup INSERT — the route INSERTs the webhook-id and checks the
// RETURNING. `seen` tracks ids so a duplicate delivery returns [] (conflict).
const { seen, returningMock } = vi.hoisted(() => {
  const seen = new Set<string>();
  const returningMock = vi.fn();
  return { seen, returningMock };
});

vi.mock("@/lib/db", () => ({
  schema: { processedWebhooks: { id: "id" } },
  db: {
    insert: () => ({
      values: (row: { id: string }) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            returningMock(row.id);
            if (seen.has(row.id)) return Promise.resolve([]);
            seen.add(row.id);
            return Promise.resolve([{ id: row.id }]);
          },
        }),
      }),
    }),
  },
}));

import { POST } from "@/app/api/billing/webhook/route";

const SECRET = "whsec_test_polar_secret";

// A FRESH timestamp (unix seconds, now) so the route's replay/freshness check
// passes. Tests that exercise staleness override it explicitly.
function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

// Build a request signed the way Polar actually signs: the secret string used
// verbatim as the raw HMAC key (the deviation our verifier tolerates).
function signed(
  body: string,
  opts: { id?: string; ts?: string; tamper?: boolean } = {},
): Request {
  const id = opts.id ?? "evt_test";
  const ts = opts.ts ?? nowTs();
  let sig = createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  if (opts.tamper) sig = `${sig.slice(0, -4)}AAAA`;
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": `v1,${sig}`,
      "content-type": "application/json",
    },
    body,
  });
}

function subEvent(status: string): string {
  return JSON.stringify({
    type: "subscription.active",
    data: {
      id: "sub_1",
      status,
      customer_id: "cus_1",
      customer: { external_id: "user_123" },
      metadata: { userId: "user_123" },
    },
  });
}

const SUB_ACTIVE = subEvent("active");

const prevSecret = process.env.POLAR_WEBHOOK_SECRET;

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    process.env.POLAR_WEBHOOK_SECRET = SECRET;
    applySubscriptionStateMock.mockReset();
    returningMock.mockReset();
    seen.clear();
  });
  afterAll(() => {
    process.env.POLAR_WEBHOOK_SECRET = prevSecret;
  });

  it("verifies a real-style signed subscription.active and flips to pro", async () => {
    const res = await POST(signed(SUB_ACTIVE));
    expect(res.status).toBe(200);
    expect(applySubscriptionStateMock).toHaveBeenCalledWith({
      userId: "user_123",
      status: "active",
      customerId: "cus_1",
      subscriptionId: "sub_1",
    });
  });

  it("rejects a tampered signature with 403 and never touches the plan", async () => {
    const res = await POST(signed(SUB_ACTIVE, { tamper: true }));
    expect(res.status).toBe(403);
    expect(applySubscriptionStateMock).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp with 403 and never touches the plan", async () => {
    const res = await POST(signed(SUB_ACTIVE, { ts: "1700000000" }));
    expect(res.status).toBe(403);
    expect(applySubscriptionStateMock).not.toHaveBeenCalled();
  });

  it("ignores a duplicate webhook-id without reapplying", async () => {
    const first = await POST(signed(SUB_ACTIVE, { id: "evt_dup" }));
    expect(first.status).toBe(200);
    expect(applySubscriptionStateMock).toHaveBeenCalledTimes(1);

    const second = await POST(signed(SUB_ACTIVE, { id: "evt_dup" }));
    expect(second.status).toBe(200);
    // Still only the one application — the dup short-circuits.
    expect(applySubscriptionStateMock).toHaveBeenCalledTimes(1);
  });

  it("acknowledges non-subscription events without a plan change", async () => {
    const res = await POST(
      signed(JSON.stringify({ type: "order.paid", data: { id: "o1" } })),
    );
    expect(res.status).toBe(200);
    expect(applySubscriptionStateMock).not.toHaveBeenCalled();
  });

  it("downgrades to free on order.refunded", async () => {
    const res = await POST(
      signed(
        JSON.stringify({
          type: "order.refunded",
          data: { metadata: { userId: "user_123" } },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(applySubscriptionStateMock).toHaveBeenCalledWith({
      userId: "user_123",
      status: "revoked",
    });
  });

  it("returns 500 when the webhook secret is unconfigured", async () => {
    process.env.POLAR_WEBHOOK_SECRET = "";
    const res = await POST(signed(SUB_ACTIVE));
    expect(res.status).toBe(500);
  });
});
