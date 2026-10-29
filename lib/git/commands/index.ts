// The subcommands OpenLen's git has, and why the others aren't here (spec §4).
import type { Command } from "../command";
import { add } from "./add";
import { blame } from "./blame";
import { checkout } from "./checkout";
import { commit } from "./commit";
import { diff } from "./diff";
import { grep } from "./grep";
import { log } from "./log";
import { branch, config, fetch, init, lsFiles, pull, push, remote, revParse } from "./plumbing";
import { REWRITE, reset } from "./reset";
import { restore } from "./restore";
import { revert } from "./revert";
import { show } from "./show";
import { status } from "./status";
import { switchCommand } from "./switch";

export const COMMANDS: Readonly<Record<string, Command>> = {
  status, diff, log, show, blame, grep, "ls-files": lsFiles, "rev-parse": revParse, branch, config,
  add, reset, restore, checkout, switch: switchCommand, commit, revert, init, remote, push, pull, fetch,
};

/** git commands that exist elsewhere and not here: why, and what to do instead. */
export const NOT_AVAILABLE: Readonly<Record<string, string>> = {
  stash: "this project's repository keeps no stash; to set changes aside, commit them.",
  merge: "merging isn't available here yet.",
  rebase: REWRITE,
  "cherry-pick": "it isn't available here yet; bring a commit's files with git checkout <commit> -- <path>, or undo one with git revert <commit>.",
  tag: "tags aren't available here yet.",
  bisect: "it moves HEAD between commits; walk the history with git log -p or git show <commit> instead.",
  worktree: "this project has one working tree.",
  submodule: "a project here has no submodules.",
  clean: "delete files with rm: each deletion is saved as a change you can undo.",
  rm: "delete the file with rm, then git add it.",
  mv: "move it with mv, then git add both paths.",
  clone: "the project's files are already here: this is its repository.",
  reflog: "git log --all shows every branch's history.",
  apply: "write the change with the file tools, then git add it.",
  am: "write the change with the file tools, then git add it.",
  "format-patch": "show a commit's change with git show <commit>.",
  archive: "the project's files are already here.",
  gc: "the repository looks after itself here.",
};
