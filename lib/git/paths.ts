// Paths as git sees them: repository paths have no leading "/", the cwd is a repository folder
// ("" is the root), and what git prints is quoted like core.quotepath=true.
import path from "node:path";

export const toRepoPath = (absolute: string): string => absolute.replace(/^\/+/, "");
export const toAbsolute = (repoPath: string): string => `/${repoPath}`;

/** The terminal's cwd as a repository folder: "/" → "", "/src/" → "src". */
export function repoDir(cwd: string): string {
  return toRepoPath(path.posix.resolve("/", cwd));
}

/** What the user typed, from the folder `cwdDir`, as a repository path ("" = the root). */
export function resolveFromCwd(cwdDir: string, arg: string): string {
  return toRepoPath(path.posix.resolve("/", cwdDir, arg));
}

/** A repository path as git prints it from `cwdDir` (status, ls-files, grep). A folder keeps its "/". */
export function relativeToCwd(cwdDir: string, repoPath: string): string {
  const folder = repoPath.endsWith("/");
  const rel = path.posix.relative(`/${cwdDir}`, `/${repoPath.replace(/\/$/, "")}`);
  return folder ? `${rel === "" ? "." : rel}/` : rel;
}

const C_ESCAPES: Readonly<Record<number, string>> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 34: '\\"', 92: "\\\\" };

/** core.quotepath=true: a control byte, a quote, a backslash or any non-ASCII byte puts the path in quotes, with C escapes (octal for the rest).
 *  `quoteSpaces`: the short status quotes a path with a space too (git's QUOTE_PATH_QUOTE_SP). */
export function quotePath(p: string, quoteSpaces = false): string {
  let quoted = quoteSpaces && p.includes(" ");
  let out = "";
  for (const b of Buffer.from(p)) {
    const escape = C_ESCAPES[b];
    if (escape) {
      out += escape;
      quoted = true;
    } else if (b < 0x20 || b >= 0x7f) {
      out += `\\${b.toString(8).padStart(3, "0")}`;
      quoted = true;
    } else out += String.fromCharCode(b);
  }
  return quoted ? `"${out}"` : p;
}

/** Does a pathspec (already a repository path) match? A folder matches what's under it, "" matches all, and a glob's * crosses "/" as in git. */
export function matchesPathspec(spec: string, repoPath: string): boolean {
  if (spec === "") return true;
  if (/[*?[]/.test(spec)) return globRegExp(spec).test(repoPath);
  return repoPath === spec || repoPath.startsWith(`${spec}/`);
}

function globRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close < 0) re += "\\[";
      else {
        re += `[${glob.slice(i + 1, close).replace(/^!/, "^")}]`;
        i = close;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re}(?:/.*)?$`);
}
