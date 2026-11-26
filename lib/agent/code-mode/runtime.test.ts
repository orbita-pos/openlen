// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { runAgentLoop } from "@/lib/agent/loop";
import { DECLARACION_RUN_CODE } from "./declaration";
import { codeModeEnabled, RUN_CODE_TOOL } from "./enabled";
import { executeCodeMode } from "./runtime";

describe("codeModeEnabled gate", () => {
  it("is off for normal Len and on for Odyssey (dynamis) when terminal is on", () => {
    expect(codeModeEnabled("len", { OPENLEN_TERMINAL: "1" })).toBe(false);
    expect(codeModeEnabled(undefined, { OPENLEN_TERMINAL: "1" })).toBe(false);
    expect(codeModeEnabled("dynamis", { OPENLEN_TERMINAL: "1" })).toBe(true);
    expect(codeModeEnabled("dynamis", { OPENLEN_TERMINAL: "0" })).toBe(false);
  });

  it("honors OPENLEN_CODE_MODE=0 kill switch and OPENLEN_CODE_MODE=1 opt-in", () => {
    expect(codeModeEnabled("dynamis", { OPENLEN_TERMINAL: "1", OPENLEN_CODE_MODE: "0" })).toBe(false);
    expect(codeModeEnabled("len", { OPENLEN_TERMINAL: "1", OPENLEN_CODE_MODE: "1" })).toBe(true);
  });

  it("leaves normal Len's system prompt and declarations byte-for-byte untouched", () => {
    const env = { OPENLEN_TERMINAL: "1" };
    expect(buildAgentSystemPrompt(env)).toBe(buildAgentSystemPrompt(env, "len"));
    expect(buildFunctionDeclarations(env).map((d) => d.name)).not.toContain(RUN_CODE_TOOL);
    expect(buildFunctionDeclarations(env, {}, "dynamis").map((d) => d.name)).toContain(RUN_CODE_TOOL);
  });
});

describe("executeCodeMode — QuickJS WASM sandbox", () => {
  const DECLARED = new Set(["Read", "Edit", "Write", "bash", "publish", "ask_user_question"]);

  it("executes TypeScript with top-level await, console capture, and distilled return", async () => {
    const files: Record<string, string> = {
      "/src/a.ts": "export const SPEED = 12;\nexport const JUMP = 8;\n",
      "/src/b.ts": "export const GRAVITY = -24;\n",
    };
    const res = await executeCodeMode({
      declaredTools: DECLARED,
      code: `
        interface Summary { file: string; exports: string[] }
        const paths: readonly string[] = ["/src/a.ts", "/src/b.ts"];
        const out: Summary[] = [];
        for (const p of paths) {
          const r = await tools.Read({ file_path: p });
          const names = [...String(r.text).matchAll(/export const (\\w+)/g)].map((m) => m[1]);
          out.push({ file: p, exports: names });
        }
        console.log("scanned", out.length, "files");
        return out;
      `,
      callTool: async (_name, args) => ({
        ok: true,
        tool_result: files[String(args.file_path)] ?? "",
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.logs).toEqual(["scanned 2 files"]);
    expect(res.value).toEqual([
      { file: "/src/a.ts", exports: ["SPEED", "JUMP"] },
      { file: "/src/b.ts", exports: ["GRAVITY"] },
    ]);
    expect(res.formatted).toContain("[tools: Read×2]");
    expect(res.formatted).toContain("scanned 2 files");
  });

  it("runs parallel-safe Read calls concurrently and serializes mutating Edit calls", async () => {
    let activeReads = 0;
    let peakReads = 0;
    let activeEdits = 0;
    let peakEdits = 0;

    const res = await executeCodeMode({
      declaredTools: DECLARED,
      isParallel: (name) => name === "Read",
      code: `
        await Promise.all([
          tools.Read({ file_path: "/1" }),
          tools.Read({ file_path: "/2" }),
          tools.Read({ file_path: "/3" }),
        ]);
        await Promise.all([
          tools.Edit({ file_path: "/1", old_string: "a", new_string: "b" }),
          tools.Edit({ file_path: "/2", old_string: "a", new_string: "b" }),
        ]);
        return "ok";
      `,
      callTool: async (name) => {
        if (name === "Read") {
          activeReads += 1;
          peakReads = Math.max(peakReads, activeReads);
          await new Promise((r) => setTimeout(r, 25));
          activeReads -= 1;
        } else {
          activeEdits += 1;
          peakEdits = Math.max(peakEdits, activeEdits);
          await new Promise((r) => setTimeout(r, 20));
          activeEdits -= 1;
        }
        return { ok: true, tool_result: "done" };
      },
    });

    expect(res.ok).toBe(true);
    expect(peakReads).toBe(3);
    expect(peakEdits).toBe(1);
  });

  it("exposes zero host globals (process, require, fetch) and prevents prototype escape", async () => {
    const res = await executeCodeMode({
      declaredTools: DECLARED,
      code: `
        const Fn = (function () {}).constructor;
        let hostProcess = "none";
        try {
          hostProcess = typeof Fn("return process")();
        } catch (e) {
          hostProcess = "blocked";
        }
        return {
          processType: typeof (globalThis as Record<string, unknown>).process,
          requireType: typeof (globalThis as Record<string, unknown>).require,
          fetchType: typeof (globalThis as Record<string, unknown>).fetch,
          hostProcess,
        };
      `,
      callTool: async () => ({ ok: true }),
    });

    expect(res.ok).toBe(true);
    expect(res.value).toEqual({
      processType: "undefined",
      requireType: "undefined",
      fetchType: "undefined",
      hostProcess: "blocked",
    });
  });

  it("interrupts synchronous infinite loops both at top-level and after an await", async () => {
    const topLevel = await executeCodeMode({
      declaredTools: DECLARED,
      maxSyncCpuMs: 60,
      code: `while (true) {}`,
      callTool: async () => ({ ok: true }),
    });
    expect(topLevel.ok).toBe(false);
    expect(topLevel.error).toMatch(/CPU slice|interrupted/i);

    const postAwait = await executeCodeMode({
      declaredTools: DECLARED,
      maxSyncCpuMs: 60,
      code: `
        await tools.Read({ file_path: "/index.html" });
        while (true) {}
      `,
      callTool: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { ok: true, tool_result: "<h1>Hi</h1>" };
      },
    });
    expect(postAwait.ok).toBe(false);
    expect(postAwait.error).toMatch(/CPU slice|interrupted/i);
  });

  it("contains WASM heap memory exhaustion without crashing the host", async () => {
    const res = await executeCodeMode({
      declaredTools: DECLARED,
      memoryLimitBytes: 8 * 1024 * 1024,
      maxSyncCpuMs: 250,
      code: `
        const huge = new Uint8Array(16 * 1024 * 1024);
        return huge.byteLength;
      `,
      callTool: async () => ({ ok: true }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/memory|RangeError|InternalError/i);
  });

  it("rejects interactive/control tools, undeclared tools, and recursive run_code", async () => {
    const res = await executeCodeMode({
      declaredTools: new Set([...DECLARED, RUN_CODE_TOOL]),
      code: `
        const errors: string[] = [];
        for (const name of ["publish", "ask_user_question", "run_code", "nonexistent_tool"]) {
          try {
            await (tools as Record<string, (a: unknown) => Promise<unknown>>)[name]({});
          } catch (e) {
            errors.push((e as Error).message);
          }
        }
        return errors;
      `,
      callTool: async () => ({ ok: true }),
    });
    expect(res.ok).toBe(true);
    const errors = res.value as string[];
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/cannot be called inside run_code/);
    expect(errors[1]).toMatch(/cannot be called inside run_code/);
    expect(errors[2]).toMatch(/cannot be called inside run_code/);
    expect(errors[3]).toMatch(/not available in this session/);
  });

  it("enforces maxSubcalls per run_code execution", async () => {
    let executed = 0;
    const res = await executeCodeMode({
      declaredTools: DECLARED,
      maxSubcalls: 4,
      code: `
        for (let i = 0; i < 10; i++) {
          await tools.Read({ file_path: "/f" + i });
        }
      `,
      callTool: async () => {
        executed += 1;
        return { ok: true, tool_result: "ok" };
      },
    });
    expect(res.ok).toBe(false);
    expect(executed).toBe(4);
    expect(res.error).toMatch(/limit of 4 tool calls/);
  });
});

describe("run_code inside runAgentLoop", () => {
  async function* scripted(events: StreamEvent[]): AsyncIterable<StreamEvent> {
    for (const ev of events) yield ev;
  }

  it("batches Read + Edit in one step, emits live html + diagnostics, and prevents visitor-data spill", async () => {
    const step1: StreamEvent[] = [
      {
        type: "function_call",
        name: RUN_CODE_TOOL,
        args: {
          description: "Inspect submissions and update hero",
          code: `
            const sub = await tools.list_form_submissions({ which: "new" });
            const page = await tools.Read({ file_path: "/index.html" });
            await tools.Edit({ file_path: "/index.html", old_string: "Old", new_string: "New" });
            return { unseen: sub.unseen, hadOld: String(page.text).includes("Old"), pad: "Z".repeat(4000) };
          `,
        },
      },
      { type: "usage", inputTokens: 100, outputTokens: 50, cachedTokens: 80, thinkingTokens: 10 },
      { type: "done", stopReason: { kind: "end_turn" } },
    ];
    const step2: StreamEvent[] = [
      { type: "text_delta", text: "Updated!" },
      { type: "usage", inputTokens: 150, outputTokens: 10, cachedTokens: 120, thinkingTokens: 5 },
      { type: "done", stopReason: { kind: "end_turn" } },
    ];
    const seenMessages: Message[][] = [];
    let callIdx = 0;
    const emitted: unknown[] = [];
    const spilledPaths: string[] = [];

    const result = await runAgentLoop({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "update hero" },
      ],
      tools: [
        { name: "Read" },
        { name: "Edit" },
        { name: "list_form_submissions" },
        DECLARACION_RUN_CODE,
      ],
      openStream: (msgs) => {
        seenMessages.push(structuredClone(msgs));
        return scripted(callIdx++ === 0 ? step1 : step2);
      },
      closeOut: () => scripted(step2),
      runTool: async (name) => {
        if (name === "list_form_submissions") {
          return { response: { ok: true, unseen: 2, tool_result: "visitor@example.com wrote hello" } };
        }
        if (name === "Read") {
          return { response: { ok: true, tool_result: "<h1>Old</h1>" } };
        }
        if (name === "Edit") {
          return {
            response: { ok: true, cambio: "cambio", tool_result: "Edited /index.html" },
            updatedHtml: "<h1>New</h1>",
            page: null,
            mutoDurable: true,
            diagnosticos: [{ archivo: "/index.html", linea: 1, severidad: "warning", mensaje: "sample warning" } as never],
          };
        }
        return { response: { ok: false, error: "unexpected" } };
      },
      emit: (ev) => emitted.push(ev),
      spill: {
        maxInlineTokens: 50,
        save: async (path) => {
          spilledPaths.push(path);
          return true;
        },
      },
    });

    expect(result.finalText).toBe("Updated!");
    expect(result.mutoDurable).toBe(true);
    // Live canvas updated from the inner Edit!
    expect(emitted).toContainEqual({ type: "html", html: "<h1>New</h1>", page: null });
    // Action card emitted with our description!
    expect(emitted).toContainEqual({
      type: "action",
      tool: "run_code",
      status: "running",
      summary: "Inspect submissions and update hero",
    });
    expect(emitted).toContainEqual({
      type: "action",
      tool: "run_code",
      status: "done",
      summary: "Inspect submissions and update hero",
    });
    // Invariant 5: visitor data touched inside run_code is NEVER written to /tmp/spill!
    expect(spilledPaths).toEqual([]);
    // Diagnostics from inner Edit reached the second LLM call!
    const secondCallSerialized = JSON.stringify(seenMessages[1]);
    expect(secondCallSerialized).toContain("sample warning");
  });
});
