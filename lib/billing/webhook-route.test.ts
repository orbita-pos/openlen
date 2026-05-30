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

import { POST } from "@/app/api/billing/webhook/route";

const SECRET = "whsec_test_polar_secret";
const ID = "evt_test";
const TS = "1700000000";

// Build a request signed the way Polar actually signs: the secret string used
// verbatim as the raw HMAC key (the deviation our verifier tolerates).
function signed(body: string, tamper = false): Request {
  let sig = createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${ID}.${TS}.${body}`)
    .digest("base64");
  if (tamper) sig = `${sig.slice(0, -4)}AAAA`;
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: {
      "webhook-id": ID,
      "webhook-timestamp": TS,
      "webhook-signature": `v1,${sig}`,
      "content-type": "application/json",
    },
    body,
  });
}

const SUB_ACTIVE = JSON.stringify({
  type: "subscription.active",
  data: {
    id: "sub_1",
    status: "active",
    customer_id: "cus_1",
    customer: { external_id: "user_123" },
    metadata: { userId: "user_123" },
  },
});

const prevSecret = process.env.POLAR_WEBHOOK_SECRET;

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    process.env.POLAR_WEBHOOK_SECRET = SECRET;
    applySubscriptionStateMock.mockReset();
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
    const res = await POST(signed(SUB_ACTIVE, true));
    expect(res.status).toBe(403);
    expect(applySubscriptionStateMock).not.toHaveBeenCalled();
  });

  it("acknowledges non-subscription events without a plan change", async () => {
    const res = await POST(
      signed(JSON.stringify({ type: "order.paid", data: { id: "o1" } })),
    );
    expect(res.status).toBe(200);
    expect(applySubscriptionStateMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the webhook secret is unconfigured", async () => {
    process.env.POLAR_WEBHOOK_SECRET = "";
    const res = await POST(signed(SUB_ACTIVE));
    expect(res.status).toBe(500);
  });
});
