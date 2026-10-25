// Real production scenes (layer 1 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §5.2): the repo holds only their ids
// (`scenes.json`); the rows themselves are customer text and live OUTSIDE the
// repo, in `OPENLEN_REPLAY_SCENES_DIR` or `~/.openlen/replay-scenes`, written by
// `npm run replay-scenes:fetch` (read-only, over ssh).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ReplayAllowance } from "@/lib/agent/testing/replay-invariant";
import type { TranscripcionGuardada } from "@/lib/agent/transcripcion";
import scenesJson from "./scenes.json";

export interface SceneSpec {
  readonly name: string;
  readonly projectId: string;
  /** The first and last turn to replay; every turn between them is replayed too. */
  readonly rowIds: readonly string[];
  readonly why: string;
  readonly allow?: readonly ReplayAllowance[];
}

export const scenes: readonly SceneSpec[] = scenesJson as SceneSpec[];

export const scenesDir = (): string => process.env.OPENLEN_REPLAY_SCENES_DIR ?? join(homedir(), ".openlen", "replay-scenes");

/** One `projectChatMessages` row as the fetcher wrote it (the JSON Postgres gave back). */
export interface SceneRow {
  readonly id: string;
  readonly createdAt: string;
  readonly status: string;
  readonly tipo: string | null;
  readonly userText: string;
  readonly assistantReasoning: string;
  readonly transcript: TranscripcionGuardada | null;
  readonly attachedImage: unknown;
  readonly actions: unknown;
}

export interface SceneFile {
  readonly name: string;
  readonly projectId: string;
  readonly fetchedAt: string;
  /** Closed turns of the conversation older than `rows[0]`, not downloaded: the
   *  route's window (`turnosQueSeQuedan`) counts them. */
  readonly olderTurns: number;
  /** From the oldest turn of the first replayed turn's window to the last replayed turn. */
  readonly rows: readonly SceneRow[];
}

export function readScene(name: string): SceneFile | null {
  const file = join(scenesDir(), `${name}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as SceneFile;
}
