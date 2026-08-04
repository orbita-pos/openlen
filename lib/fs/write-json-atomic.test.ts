import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  AtomicJsonWriteError,
  writeJsonAtomic,
} from "./write-json-atomic";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openlen-write-json-atomic-"));
  directories.push(directory);
  return directory;
}

function replacementError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code} replacement failure`), { code });
}

describe("writeJsonAtomic", () => {
  it("writes newline-terminated formatted JSON without touching the previous file early", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "artifact.json");
    await writeFile(targetPath, '{"previous":true}\n');
    let previousContentsDuringRename: string | undefined;
    let temporaryContentsDuringRename: string | undefined;

    await writeJsonAtomic(targetPath, { next: ["value"] }, {
      randomId: () => "test-id",
      rename: async (from, to) => {
        previousContentsDuringRename = await readFile(to, "utf8");
        temporaryContentsDuringRename = await readFile(from, "utf8");
        await rename(from, to);
      },
    });

    expect(previousContentsDuringRename).toBe('{"previous":true}\n');
    expect(temporaryContentsDuringRename).toBe('{\n  "next": [\n    "value"\n  ]\n}\n');
    expect(await readFile(targetPath, "utf8")).toBe('{\n  "next": [\n    "value"\n  ]\n}\n');
  });

  it("retries EPERM with exactly 20, 40, 80, 160, and 320 millisecond bounds", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "artifact.json");
    const delays: number[] = [];
    let attempts = 0;

    await writeJsonAtomic(targetPath, { complete: true }, {
      randomId: () => "retry-id",
      sleep: async (delayMs) => { delays.push(delayMs); },
      rename: async (from, to) => {
        attempts += 1;
        if (attempts <= 5) throw replacementError("EPERM");
        await rename(from, to);
      },
    });

    expect(attempts).toBe(6);
    expect(delays).toEqual([20, 40, 80, 160, 320]);
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual({ complete: true });
  });

  it.each(["EACCES", "EBUSY"])("retries transient %s replacement failures", async (code) => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "artifact.json");
    const delays: number[] = [];
    let attempts = 0;

    await writeJsonAtomic(targetPath, { code }, {
      randomId: () => `${code}-id`,
      sleep: async (delayMs) => { delays.push(delayMs); },
      rename: async (from, to) => {
        attempts += 1;
        if (attempts === 1) throw replacementError(code);
        await rename(from, to);
      },
    });

    expect(attempts).toBe(2);
    expect(delays).toEqual([20]);
  });

  it("does not retry a non-transient EINVAL", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "artifact.json");
    const delays: number[] = [];
    let attempts = 0;

    await expect(writeJsonAtomic(targetPath, { invalid: true }, {
      randomId: () => "invalid-id",
      sleep: async (delayMs) => { delays.push(delayMs); },
      rename: async () => {
        attempts += 1;
        throw replacementError("EINVAL");
      },
    })).rejects.toMatchObject({ code: "EINVAL" });

    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it("preserves the prior destination and final temporary file after exhaustion", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "artifact.json");
    await writeFile(targetPath, '{"previous":true}\n');
    let attempts = 0;
    let actualTemporaryPath: string | undefined;
    const rawMessage = "raw rename failure must not leak";

    let failure: AtomicJsonWriteError | undefined;
    try {
      await writeJsonAtomic(targetPath, { replacement: "failed" }, {
        randomId: () => "exhausted-id",
        sleep: async () => undefined,
        rename: async (from, to) => {
          attempts += 1;
          actualTemporaryPath = from;
          throw Object.assign(new Error(`${rawMessage}: ${from} -> ${to}`), {
            code: "EPERM",
            path: from,
            dest: to,
          });
        },
      });
    } catch (error) {
      failure = error as AtomicJsonWriteError;
    }

    expect(failure).toBeInstanceOf(AtomicJsonWriteError);
    expect(failure).toMatchObject({
      code: "EPERM",
      targetPath: relative(process.cwd(), targetPath),
      temporaryPath: relative(process.cwd(), actualTemporaryPath!),
    });
    expect(attempts).toBe(6);
    expect(await readFile(targetPath, "utf8")).toBe('{"previous":true}\n');
    expect(resolve(process.cwd(), failure!.temporaryPath)).toBe(actualTemporaryPath);
    expect(existsSync(resolve(process.cwd(), failure!.temporaryPath))).toBe(true);
    expect(await readFile(resolve(process.cwd(), failure!.temporaryPath), "utf8")).toBe('{\n  "replacement": "failed"\n}\n');

    const exposed = JSON.stringify({
      cause: failure!.cause,
      message: failure!.message,
      serialized: JSON.stringify(failure),
      stack: failure!.stack,
      targetPath: failure!.targetPath,
      temporaryPath: failure!.temporaryPath,
    });
    expect(failure!.cause).toBeUndefined();
    for (const secret of [directory, targetPath, actualTemporaryPath!, rawMessage]) {
      expect(exposed).not.toContain(secret);
    }
  });
});
