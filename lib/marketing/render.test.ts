import { describe, expect, it } from "vitest";
import { renderCacheKey } from "./render";

describe("renderCacheKey", () => {
  it("is stable for same inputs and changes with content", () => {
    const a = renderCacheKey("abc123def456", "<html>1</html>");
    expect(a).toBe(renderCacheKey("abc123def456", "<html>1</html>"));
    expect(a).toMatch(/^marketing\/abc123def456-[0-9a-f]{16}\.png$/);
    expect(a).not.toBe(renderCacheKey("abc123def456", "<html>2</html>"));
  });

  it("changes with contentHash even for the same filled html", () => {
    const html = "<html>same</html>";
    expect(renderCacheKey("hash-one", html)).not.toBe(renderCacheKey("hash-two", html));
  });
});
