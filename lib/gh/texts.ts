// What `gh` says, copied from the GitHub CLI (github.com/cli/cli, MIT License, trunk read on 2026-10-28) as it says it
// without a terminal — the way Claude Code runs it. Where OpenLen changes a line, it is because there is no
// `gh auth login` here: the project's owner connects GitHub in OpenLen.

/** Where the owner connects GitHub (lib/git/remotes.ts says the same to git). */
export const CONNECT = "Publish → Export → Connect GitHub";

// pkg/cmd/auth/status: «You are not logged into any GitHub hosts. To log in, run: gh auth login».
export const NOT_LOGGED_IN = `You are not logged into any GitHub hosts. To log in, the project's owner connects GitHub in OpenLen: ${CONNECT}.\n`;

// pkg/cmdutil/auth_check.go: «To get started with GitHub CLI, please run:  gh auth login …» — exit 4.
export const AUTH_REQUIRED = `To get started with GitHub CLI, the project's owner connects GitHub in OpenLen: ${CONNECT}.\n`;
export const EXIT_AUTH = 4;

// pkg/cmd/factory/remote_resolver.go
export const NO_REMOTES = "no git remotes found\n";
export const NO_GITHUB_REMOTE = "none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`\n";

// pkg/cmd/repo/create/create.go
export const VISIBILITY_REQUIRED = "`--public`, `--private`, or `--internal` required when not running interactively\n";
export const PUSH_NEEDS_SOURCE = "the `--push` option can only be used with `--source`\n";
export const NAME_REQUIRED = "name argument required when not running interactively\n";
export const NAME_EXISTS = "GraphQL: Name already exists on this account (createRepository)\n";

// pkg/cmd/pr/create/create.go
export const MUST_PUSH = "aborted: you must first push the current branch to a remote, or use the --head flag\n";
export const TITLE_BODY_REQUIRED = "must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively\n";
export const prExists = (head: string, base: string, url: string) => `a pull request for branch "${head}" into branch "${base}" already exists:\n${url}\n`;
export const uncommitted = (n: number) => `Warning: ${n} uncommitted change${n === 1 ? "" : "s"}\n`;

// pkg/cmd/pr/merge/merge.go
export const MERGE_METHOD_REQUIRED = "--merge, --rebase, or --squash required when not running interactively\n";

// pkg/cmd/pr/shared/finder.go
export const noPrForBranch = (branch: string) => `no pull requests found for branch "${branch}"\n`;

// cmd/gh: an unknown command, with cobra's usage line.
export const unknownCommand = (cmd: string) =>
  `unknown command "${cmd}" for "gh"\n\nUsage:  gh <command> <subcommand> [flags]\n\nAvailable commands:\n  auth\n  issue\n  pr\n  repo\n`;

// api/client.go: a REST error, «HTTP 422: Validation Failed (https://api.github.com/user/repos)».
export const httpError = (status: number, message: string, url: string) => `HTTP ${status}: ${message} (${url})\n`;

/** OpenLen's own line, for what this `gh` doesn't do. */
export const notHere = (what: string, instead: string) => `gh ${what}: not available here. ${instead}\n`;

export const PERMISSION_DENIED = "permission denied: only the project's owner and editors can change its GitHub repository\n";

export const HELP = `Work seamlessly with GitHub from the command line. In OpenLen, gh uses the GitHub account the project's owner connected (${CONNECT}).

USAGE
  gh <command> <subcommand> [flags]

COMMANDS
  auth status:   Show the connected GitHub account
  repo create:   Create a new repository (--public|--private, --source=. --remote=origin --push)
  repo view:     View the repository of origin (--json fields)
  pr create:     Create a pull request (--title, --body, --base, --head, --draft)
  pr list:       List pull requests (--state, --limit, --json)
  pr view:       View a pull request (--json)
  pr checks:     Show the checks of a pull request
  pr merge:      Merge a pull request (--merge|--squash|--rebase, --delete-branch)
  issue list:    List issues (--state, --limit, --json)
  issue view:    View an issue (--json)
`;
