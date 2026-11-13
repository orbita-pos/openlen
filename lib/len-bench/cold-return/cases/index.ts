// The twelve cases of the return bench (spec local 2026-11-13-conversar-todo-el-mes, §8.2): six of talking
// and researching with the assistant, six of building with Len.
import type { ReturnCase } from "../types";
import { BUILD_CASES } from "./build";
import { CHAT_CASES } from "./chat";

export const RETURN_CASES: readonly ReturnCase[] = [...CHAT_CASES, ...BUILD_CASES];

/** The pilot (spec §8.3): one case of each family, the two cheapest to build. */
export const PILOT_CASE_IDS: readonly string[] = ["chat-pumps-40k", "build-page-lamps-40k"];

/** The cases named in `only` (all of them when absent), in the bench's order. An unknown id is an error:
 *  a typo must not quietly run nothing. */
export function selectCases(only?: readonly string[]): ReturnCase[] {
  if (!only || only.length === 0) return [...RETURN_CASES];
  const unknown = only.filter((id) => !RETURN_CASES.some((c) => c.id === id));
  if (unknown.length > 0) throw new Error(`no such case: ${unknown.join(", ")} (there are: ${RETURN_CASES.map((c) => c.id).join(", ")})`);
  return RETURN_CASES.filter((c) => only.includes(c.id));
}
