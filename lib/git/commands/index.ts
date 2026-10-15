// The subcommands OpenLen's git has, and why the others aren't here (spec §4).
import type { Command } from "../command";
import { add } from "./add";
import { blame } from "./blame";
import { ONE_BRANCH, checkout } from "./checkout";
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

export const COMMANDS: Readonly<Record<string, Command>> = {
  status, diff, log, show, blame, grep, "ls-files": lsFiles, "rev-parse": revParse, branch, config,
  add, reset, restore, checkout, commit, revert, init, remote, push, pull, fetch,
};

/** git commands that exist elsewhere and not here: why, and what to do instead. */
export const NOT_AVAILABLE: Readonly<Record<string, string>> = {
  stash: "this project's repository keeps no stash; to set changes aside, commit them.",
  switch: ONE_BRANCH,
  merge: "this project's repository has one branch, main: there is nothing to merge.",
  rebase: REWRITE,
  "cherry-pick": "this project's repository has one branch, main; to undo a commit, git revert <commit>.",
  tag: "tags aren't available here yet.",
  bisect: "it moves HEAD between commits; walk the history with git log -p or git show <commit> instead.",
  worktree: "this project has one working tree.",
  submodule: "a project here has no submodules.",
  clean: "delete files with rm: each deletion is saved as a change you can undo.",
  rm: "delete the file with rm, then git add it.",
  mv: "move it with mv, then git add both paths.",
  clone: "the project's files are already here: this is its repository.",
  reflog: "the history here is a line: git log shows all of it.",
  apply: "write the change with the file tools, then git add it.",
  am: "write the change with the file tools, then git add it.",
  "format-patch": "show a commit's change with git show <commit>.",
  archive: "the project's files are already here.",
  gc: "the repository looks after itself here.",
};
