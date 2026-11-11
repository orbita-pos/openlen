import { afterEach, describe, expect, it } from "vitest";

import { assistantConversationKey, isAssistantConversation } from "./conversation";
import { assistantsEnabled } from "./enabled";

describe("the assistant's conversation key", () => {
  it("keys an assistant's conversation", () => {
    expect(assistantConversationKey("a1")).toBe("assistant:a1");
    expect(isAssistantConversation("assistant:a1")).toBe(true);
    expect(isAssistantConversation(null)).toBe(false);
    expect(isAssistantConversation("c_123")).toBe(false);
  });
});

describe("assistantsEnabled", () => {
  const before = process.env.OPENLEN_ASSISTANT;
  afterEach(() => {
    if (before === undefined) delete process.env.OPENLEN_ASSISTANT;
    else process.env.OPENLEN_ASSISTANT = before;
  });
  it("is on unless the switch is exactly 0", () => {
    delete process.env.OPENLEN_ASSISTANT;
    expect(assistantsEnabled()).toBe(true);
    process.env.OPENLEN_ASSISTANT = "1";
    expect(assistantsEnabled()).toBe(true);
    process.env.OPENLEN_ASSISTANT = "0";
    expect(assistantsEnabled()).toBe(false);
  });
});
