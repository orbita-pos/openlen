// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  POST_COMPACT_MAX_FILES,
  POST_COMPACT_MAX_TOKENS_PER_FILE,
  POST_COMPACT_TOKEN_BUDGET,
  restoredFilesMessage,
} from "./restore-files";

// A11: after a summary, Claude Code attaches again the files read most recently
// (binary 2.1.304, `Clr`: 5 files, 5,000 tokens each, 50,000 in all).
describe("restoredFilesMessage", () => {
  const file = (path: string, tokens = 10, output: string | null = `1\t<h1>${path}</h1>`) => ({ path, output, tokens });

  it("🔴 the numbers are Claude Code's", () => {
    expect([POST_COMPACT_MAX_FILES, POST_COMPACT_MAX_TOKENS_PER_FILE, POST_COMPACT_TOKEN_BUDGET]).toEqual([5, 5_000, 50_000]);
  });

  it("🔴 at most 5 files, each as Claude Code shows a Read", () => {
    const m = restoredFilesMessage(["/a", "/b", "/c", "/d", "/e", "/f", "/g"].map((p) => file(p)))!;
    expect(m.role).toBe("user");
    expect(m.content).toContain('Called the Read tool with the following input: {"file_path":"/a"}\nResult of calling the Read tool:\n1\t<h1>/a</h1>');
    expect(m.content).toContain('{"file_path":"/e"}');
    expect(m.content).not.toContain('{"file_path":"/f"}');
  });

  it("🔴 a file over 5,000 tokens comes back as Claude Code's note", () => {
    const m = restoredFilesMessage([file("/grande.html", 6_000)])!;
    expect(m.content).toBe(
      "Note: /grande.html was read before the last conversation was summarized, but the contents are too large to include. Use Read tool if you need to access it.",
    );
  });

  it("the 50,000-token budget leaves out what does not fit; a file that no longer exists does not come back", () => {
    const m = restoredFilesMessage([file("/x", 4_900), ...Array.from({ length: 4 }, (_, i) => file(`/y${i}`, 4_900)), file("/borrada", 10, null)])!;
    expect(m.content.match(/Called the Read tool/g)).toHaveLength(5);
    const tight = restoredFilesMessage(Array.from({ length: 5 }, (_, i) => file(`/z${i}`, 4_999)));
    expect(tight!.content.match(/Called the Read tool/g)).toHaveLength(5);
    expect(restoredFilesMessage([file("/borrada", 10, null)])).toBeNull();
    expect(restoredFilesMessage([])).toBeNull();
  });
});
