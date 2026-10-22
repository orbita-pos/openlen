// What the real terminal needs from a box provider (spec local 2026-10-21-real-terminal-e2b, §4):
// create, resume, run, move files, pause, kill. The E2B one is ./e2b-driver.ts; ./fake-driver.ts
// is an in-memory one for tests. Paths are the box's, which are the project's (./paths.ts).

import type { BoxNetwork } from "./box-network";

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** It ran past `timeoutMs` and is still running (Claude Code moves it to the background). */
  readonly timedOut: boolean;
  /** The turn was stopped while it ran; the process was killed. */
  readonly aborted?: boolean;
  readonly pid?: number;
}

export interface SandboxHandle {
  readonly id: string;
  run(
    command: string,
    o: {
      readonly timeoutMs: number;
      readonly signal?: AbortSignal;
      readonly onOutput?: (chunk: string) => void;
      /** Start it and come back at once with its pid. */
      readonly background?: boolean;
    },
  ): Promise<RunResult>;
  write(files: Readonly<Record<string, string>>): Promise<void>;
  remove(paths: readonly string[]): Promise<void>;
  /** Files that don't exist are left out; a file that is not UTF-8 is `{ binary, size }`. */
  read(paths: readonly string[]): Promise<Record<string, { readonly text: string } | { readonly binary: true; readonly size: number }>>;
  /** The names in a folder; `[]` if it doesn't exist. */
  list(dir: string): Promise<string[]>;
  pause(): Promise<void>;
  kill(): Promise<void>;
}

export interface SandboxDriver {
  /** `network`: the project's OpenLen hosts the box may reach, with the box's marker (./box-network.ts). */
  create(o: { readonly template: string; readonly metadata: Readonly<Record<string, string>>; readonly network?: BoxNetwork | null }): Promise<SandboxHandle>;
  /** With `network`, the box's network is set again (the project may have gained hosts since it paused). */
  resume(sandboxId: string, network?: BoxNetwork | null): Promise<SandboxHandle>;
  kill(sandboxId: string): Promise<void>;
}
