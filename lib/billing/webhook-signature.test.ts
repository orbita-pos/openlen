import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook-signature";

// The canonical standard-webhooks (Svix) test vector — same scheme Polar uses.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TIMESTAMP = "1614265330";
const PAYLOAD = '{"test": 2432232314}';
const SIG = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signatureHeader: SIG,
        payload: PAYLOAD,
      }),
    ).toBe(true);
  });

  it("works with the whsec_ prefix stripped by the caller", () => {
    expect(
      verifyWebhookSignature({
        secret: "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
        id: ID,
        timestamp: TIMESTAMP,
        signatureHeader: SIG,
        payload: PAYLOAD,
      }),
    ).toBe(true);
  });

  it("matches when one of several space-separated sigs is valid", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signatureHeader: `v1,aW52YWxpZA== ${SIG}`,
        payload: PAYLOAD,
      }),
    ).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        signatureHeader: SIG,
        payload: '{"test": 9999999999}',
      }),
    ).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(
      verifyWebhookSignature({
        secret: "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        id: ID,
        timestamp: TIMESTAMP,
        signatureHeader: SIG,
        payload: PAYLOAD,
      }),
    ).toBe(false);
  });

  it("rejects empty / missing inputs", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        id: "",
        timestamp: "",
        signatureHeader: "",
        payload: PAYLOAD,
      }),
    ).toBe(false);
  });
});
