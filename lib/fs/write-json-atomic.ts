import { open, rename as renameFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const ATOMIC_JSON_RETRY_DELAYS_MS = [20, 40, 80, 160, 320] as const;

export interface AtomicJsonWriterOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  randomId?: () => string;
}

export interface AtomicWriteResult {
  targetPath: string;
  temporaryPath: string;
}

export class AtomicJsonWriteError extends Error {
  readonly code: string;
  readonly targetPath: string;
  readonly temporaryPath: string;

  constructor(code: string, targetPath: string, temporaryPath: string) {
    super(`Unable to replace ${targetPath}: ${code}`);
    this.name = "AtomicJsonWriteError";
    this.stack = `${this.name}: ${this.message}`;
    this.code = code;
    this.targetPath = targetPath;
    this.temporaryPath = temporaryPath;
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "UNKNOWN";
}

function isTransientReplacementError(code: string): boolean {
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

function safeRelativePath(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return isAbsolute(relativePath) ? basename(path) : relativePath;
}

export async function writeJsonAtomic(
  targetPath: string,
  value: unknown,
  options: AtomicJsonWriterOptions = {},
): Promise<AtomicWriteResult> {
  const resolvedTargetPath = resolve(targetPath);
  const temporaryPath = join(
    dirname(resolvedTargetPath),
    `${basename(resolvedTargetPath)}.${process.pid}.${options.randomId?.() ?? crypto.randomUUID()}.tmp`,
  );
  const file = await open(temporaryPath, "wx");
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }

  const retryDelaysMs = options.retryDelaysMs ?? ATOMIC_JSON_RETRY_DELAYS_MS;
  const replace = options.rename ?? renameFile;
  const wait = options.sleep ?? sleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await replace(temporaryPath, resolvedTargetPath);
      return { targetPath: resolvedTargetPath, temporaryPath };
    } catch (error) {
      const code = errorCode(error);
      if (isTransientReplacementError(code) && attempt < retryDelaysMs.length) {
        await wait(retryDelaysMs[attempt]);
        continue;
      }
      throw new AtomicJsonWriteError(
        code,
        safeRelativePath(resolvedTargetPath),
        safeRelativePath(temporaryPath),
      );
    }
  }
}
