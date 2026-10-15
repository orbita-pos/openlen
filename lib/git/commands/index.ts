// The subcommands OpenLen's git has, and why the others aren't here (spec §4).
import type { Command } from "../command";
import { status } from "./status";

export const COMMANDS: Readonly<Record<string, Command>> = {
  status,
};

/** git commands that exist elsewhere and not here: why, and what to do instead. */
export const NOT_AVAILABLE: Readonly<Record<string, string>> = {};
