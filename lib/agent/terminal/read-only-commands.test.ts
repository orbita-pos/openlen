// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { READ_ONLY_REFUSAL as FILES_REFUSAL } from "@/lib/agent/herramientas-de-ficheros";

import { guardReadOnly, READ_ONLY_REFUSAL, readOnlyRefusal } from "./read-only-commands";

it("is the very refusal Write and Edit give", () => expect(READ_ONLY_REFUSAL).toBe(FILES_REFUSAL));

describe("readOnlyRefusal", () => {
  it("lets a read-only session read git and refuses what writes", () => {
    for (const argv of [["status"], ["log", "--oneline"], ["diff", "HEAD~1"], ["show", "HEAD"], ["blame", "index.html"], ["ls-files"], ["rev-parse", "HEAD"], ["branch"], ["branch", "-vv"], ["remote", "-v"], ["config", "--get", "user.name"], ["-C", "/", "status"], ["--no-pager", "log"]]) {
      expect(readOnlyRefusal("git", argv), argv.join(" ")).toBeNull();
    }
    for (const argv of [["commit", "-m", "x"], ["add", "."], ["switch", "-c", "x"], ["checkout", "x"], ["branch", "-D", "x"], ["branch", "nueva"], ["merge", "x"], ["reset", "--hard"], ["restore", "."], ["revert", "HEAD"], ["push"], ["pull"], ["fetch"], ["remote", "add", "o", "https://x"], ["config", "user.name", "x"], ["-c", "a=b", "commit"]]) {
      expect(readOnlyRefusal("git", argv), argv.join(" ")).toBe(READ_ONLY_REFUSAL);
    }
  });

  it("refuses gh, supabase and stripe writes and lets their reads through", () => {
    expect(readOnlyRefusal("gh", ["pr", "create"])).toBe(READ_ONLY_REFUSAL);
    expect(readOnlyRefusal("gh", ["pr", "merge", "3"])).toBe(READ_ONLY_REFUSAL);
    expect(readOnlyRefusal("gh", ["repo", "create", "x"])).toBe(READ_ONLY_REFUSAL);
    expect(readOnlyRefusal("gh", ["pr", "view", "3"])).toBeNull();
    expect(readOnlyRefusal("gh", ["auth", "status"])).toBeNull();
    expect(readOnlyRefusal("supabase", ["db", "push"])).toBe(READ_ONLY_REFUSAL);
    expect(readOnlyRefusal("supabase", ["db", "query", "insert into t values (1)"])).toBe(READ_ONLY_REFUSAL);
    expect(readOnlyRefusal("supabase", ["migration", "new", "x"])).toBe(READ_ONLY_REFUSAL);
    expect(readOnlyRefusal("supabase", ["db", "query", "--linked", "select 1"])).toBeNull();
    expect(readOnlyRefusal("supabase", ["migration", "list"])).toBeNull();
    expect(readOnlyRefusal("stripe", ["products", "create", "--name", "x"])).toBe(READ_ONLY_REFUSAL);
    expect(readOnlyRefusal("stripe", ["trigger", "checkout.session.completed"])).toBe(READ_ONLY_REFUSAL);
    expect(readOnlyRefusal("stripe", ["products", "list"])).toBeNull();
    expect(readOnlyRefusal("stripe", ["customers", "retrieve", "cus_1"])).toBeNull();
    expect(readOnlyRefusal("stripe", ["get", "/v1/balance"])).toBeNull();
    expect(readOnlyRefusal("stripe", ["--live", "products", "list"])).toBeNull();
  });

  it("help and version always read", () => {
    for (const program of ["git", "gh", "supabase", "stripe"] as const) {
      expect(readOnlyRefusal(program, ["--version"])).toBeNull();
      expect(readOnlyRefusal(program, ["commit", "--help"])).toBeNull();
    }
  });
});

describe("guardReadOnly", () => {
  it("answers a write with the refusal and exit 1 without calling the command", async () => {
    const run = vi.fn(async (_args: readonly string[], _cwd: string, _files: Readonly<Record<string, string>>) => ({ stdout: "ok", stderr: "", exitCode: 0 }));
    const guarded = guardReadOnly(true, "git", run);
    expect(await guarded(["commit", "-m", "x"], "/", {})).toEqual({ stdout: "", stderr: `${READ_ONLY_REFUSAL}\n`, exitCode: 1 });
    expect(run).not.toHaveBeenCalled();
    expect(await guarded(["status"], "/", {})).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  });
  it("is the command itself when the session can write", () => {
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    expect(guardReadOnly(false, "git", run)).toBe(run);
  });
});
