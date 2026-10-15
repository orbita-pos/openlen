// The subcommands OpenLen's git has, and why the others aren't here (spec §4).
import type { Command } from "../command";
import { add } from "./add";
import { checkout } from "./checkout";
import { commit } from "./commit";
import { diff } from "./diff";
import { log } from "./log";
import { reset } from "./reset";
import { restore } from "./restore";
import { revert } from "./revert";
import { show } from "./show";
import { status } from "./status";

export const COMMANDS: Readonly<Record<string, Command>> = {
  status,
  diff,
  log,
  show,
  add,
  reset,
  restore,
  checkout,
  commit,
  revert,
};

/** git commands that exist elsewhere and not here: why, and what to do instead. */
export const NOT_AVAILABLE: Readonly<Record<string, string>> = {};
