import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook-signature";

// The canonical standard-webhooks (Svix) test vector — the base64-decoded-key
// variant (one of the schemes verifyWebhookSignature accepts).
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

  it("accepts Polar's raw-secret-as-key scheme (secret verbatim, no base64 decode)", () => {
    const secret = "whsec_polar_style_raw_secret_123";
    const id = "evt_abc";
    const ts = "1700000000";
    const payload = '{"type":"subscription.active","data":{}}';
    // Polar signs using the full secret string as the raw UTF-8 HMAC key.
    const sig = createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(`${id}.${ts}.${payload}`)
      .digest("base64");
    expect(
      verifyWebhookSignature({
        secret,
        id,
        timestamp: ts,
        signatureHeader: `v1,${sig}`,
        payload,
      }),
    ).toBe(true);
  });
});
