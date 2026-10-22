import { describe, expect, it } from "vitest";

import { memoryStripeStore } from "../store";
import { swapTwins, twinMapFrom } from "./swap";

describe("swapTwins", () => {
  it("replaces only refs that have a twin, and only whole ids", () => {
    const map = new Map([["price_1QabcdEFGHijklmn", "price_L"]]);
    expect(swapTwins("a price_1QabcdEFGHijklmnX b price_1QabcdEFGHijklmn.", map)).toBe("a price_1QabcdEFGHijklmnX b price_L.");
  });

  it("replaces test payment links, keeping their query", () => {
    const map = new Map([["https://buy.stripe.com/test_8wM3cd", "https://buy.stripe.com/aB9xYz"]]);
    expect(swapTwins('<a href="https://buy.stripe.com/test_8wM3cd?prefilled_email=x">', map)).toBe('<a href="https://buy.stripe.com/aB9xYz?prefilled_email=x">');
  });

  it("an empty map changes nothing", () => {
    expect(swapTwins("price_1QabcdEFGHijklmn", new Map())).toBe("price_1QabcdEFGHijklmn");
  });
});

describe("twinMapFrom", () => {
  it("maps test ids and test links of the rows that have a twin", async () => {
    const s = memoryStripeStore();
    await s.recordTestObject({ projectId: "p", kind: "payment_link", testId: "plink_T1", source: "cli", testUrl: "https://buy.stripe.com/test_a" });
    await s.setTwin("p", "plink_T1", { liveId: "plink_L1", liveUrl: "https://buy.stripe.com/a", fingerprint: "f" });
    await s.recordTestObject({ projectId: "p", kind: "price", testId: "price_T2", source: "cli" });
    const map = twinMapFrom(await s.listObjects("p"));
    expect([...map]).toEqual([
      ["plink_T1", "plink_L1"],
      ["https://buy.stripe.com/test_a", "https://buy.stripe.com/a"],
    ]);
  });
});
