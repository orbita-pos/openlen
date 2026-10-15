// The errors git prints, as git prints them.

/** A command that ends with git's own error text. */
export class GitFatal extends Error {
  constructor(
    readonly stderr: string,
    readonly exitCode = 128,
    readonly stdout = "",
  ) {
    super(stderr);
  }
}

/** Git's text when `index.lock` exists: here, when someone else wrote the repository first. */
export const INDEX_LOCKED =
  "fatal: Unable to create '/.git/index.lock': File exists.\n\n" +
  "Another git process seems to be running in this repository, e.g.\n" +
  "an editor opened by 'git commit'. Please make sure all processes\n" +
  "are terminated then try again. If it still fails, a git process\n" +
  "may have crashed in this repository earlier:\n" +
  "remove the file manually to continue.\n";

export function unknownRevision(arg: string): GitFatal {
  return new GitFatal(
    `fatal: ambiguous argument '${arg}': unknown revision or path not in the working tree.\n` +
      "Use '--' to separate paths from revisions, like this:\n" +
      "'git <command> [<revision>...] -- [<file>...]'\n",
  );
}

export function pathspecDidNotMatch(arg: string): GitFatal {
  return new GitFatal(`error: pathspec '${arg}' did not match any file(s) known to git\n`, 1);
}

/** A git command or option OpenLen's repository does not have (spec §4, "Lo que no está"). */
export function notAvailable(what: string, why: string): { stdout: string; stderr: string; exitCode: number } {
  return { stdout: "", stderr: `git ${what}: not available here: ${why}\n`, exitCode: 1 };
}
