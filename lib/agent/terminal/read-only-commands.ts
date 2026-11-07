// A READ-ONLY SESSION AND THE COMMANDS OPENLEN ANSWERS (spec local 2026-11-06-asistente-propio, §4.2; Explore, Plan,
// plan mode and the person's own assistant). The terminal already puts back every file a command changed in a
// read-only session, but `git`, `gh`, `supabase` and `stripe` write through OpenLen's own handlers — git's history,
// a pull request, the draft database, Stripe's test mode — without going through that. Here they only read.
//
// Pure.

/** A read-only subagent (spec local 2026-11-01-subagentes-de-len, §4.2) or the person's own assistant: Write, Edit,
 *  what a command changes in the project and what these commands write are refused. */
export const READ_ONLY_REFUSAL = "This agent is read-only: it cannot change the project's files.";

export type AnsweredProgram = "git" | "gh" | "supabase" | "stripe";

/** git's options that take the next argument as their value. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const GIT_READS = new Set(["status", "diff", "log", "show", "blame", "grep", "ls-files", "rev-parse", "help"]);
const GIT_BRANCH_LIST = new Set(["-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "--list", "--show-current", "--no-color", "--color"]);
const GH_READS = new Set(["auth status", "repo view", "pr list", "pr view", "pr checks", "pr diff", "issue list", "issue view"]);
const SUPABASE_READS = new Set(["status", "migration list", "functions list", "secrets list"]);

/** The subcommand and what follows it, past git's own leading options. */
function gitRest(argv: readonly string[]): readonly string[] {
  let i = 0;
  while (i < argv.length && argv[i]!.startsWith("-")) i += GIT_VALUE_OPTIONS.has(argv[i]!) ? 2 : 1;
  return argv.slice(i);
}

// Every check reads FIXED positions: the subcommand is where the CLI looks for it. Skipping flags to find «the words»
// would take a flag's value for a subcommand (`stripe customers --expand list create`), and a help flag counts only as
// the whole command — OpenLen's parsers take `--help` or `-h` as a value (`git commit -am --help` commits).

function gitReads(argv: readonly string[]): boolean {
  const [sub, ...rest] = gitRest(argv);
  // Only git's own options (`git --version`, `git --help`).
  if (sub === undefined) return true;
  if (GIT_READS.has(sub)) return true;
  if (sub === "branch") return rest.every((a) => GIT_BRANCH_LIST.has(a));
  if (sub === "remote") return rest.length === 0 || (rest.length === 1 && (rest[0] === "-v" || rest[0] === "--verbose")) || rest[0] === "get-url" || rest[0] === "show";
  if (sub === "config") {
    return ((rest[0] === "--list" || rest[0] === "-l") && rest.length === 1) || ((rest[0] === "--get" || rest[0] === "--get-all") && rest.length === 2);
  }
  return false;
}

function ghReads(argv: readonly string[]): boolean {
  return GH_READS.has(`${argv[0]} ${argv[1]}`);
}

function supabaseReads(argv: readonly string[]): boolean {
  if (argv[0] === "db" && argv[1] === "query") {
    // Production, which only reads — and `--linked` as a flag of its own, not the value of the one before it.
    const i = argv.indexOf("--linked");
    return i >= 2 && !argv[i - 1]!.startsWith("-");
  }
  return (argv[0] === "status" && argv.length === 1) || SUPABASE_READS.has(`${argv[0]} ${argv[1]}`);
}

function stripeReads(argv: readonly string[]): boolean {
  const args = argv[0] === "--live" ? argv.slice(1) : argv;
  return args[0] === "get" || args[1] === "list" || args[1] === "retrieve";
}

const HELP = new Set(["--help", "-h", "--version"]);

/** `null` when the command only reads; otherwise the read-only refusal. */
export function readOnlyRefusal(program: AnsweredProgram, argv: readonly string[]): string | null {
  if (argv.length === 1 && HELP.has(argv[0]!)) return null;
  const reads =
    program === "git" ? gitReads(argv) : program === "gh" ? ghReads(argv) : program === "supabase" ? supabaseReads(argv) : stripeReads(argv);
  return reads ? null : READ_ONLY_REFUSAL;
}

type Answer = { stdout: string; stderr: string; exitCode: number };

/** The command as the terminal gets it: itself when the session can write; when it is read-only, a write answers
 *  the refusal with exit 1 and never reaches the command. */
export function guardReadOnly<F extends (args: readonly string[], ...rest: never[]) => Promise<Answer>>(readOnly: boolean, program: AnsweredProgram, run: F): F {
  if (!readOnly) return run;
  return (async (args: readonly string[], ...rest: never[]) => {
    const refusal = readOnlyRefusal(program, args);
    if (refusal) return { stdout: "", stderr: `${refusal}\n`, exitCode: 1 };
    return run(args, ...rest);
  }) as F;
}
