// The subcommands OpenLen's git has, and why the others aren't here (spec §4).
import type { Command } from "../command";
import { add } from "./add";
import { commit } from "./commit";
import { diff } from "./diff";
import { reset } from "./reset";
import { status } from "./status";

export const COMMANDS: Readonly<Record<string, Command>> = {
  status,
  diff,
  add,
  reset,
  commit,
};

/** git commands that exist elsewhere and not here: why, and what to do instead. */
export const NOT_AVAILABLE: Readonly<Record<string, string>> = {};
