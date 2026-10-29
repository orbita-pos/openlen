// How git writes and reads commit messages.
import { compareNames } from "./objects";
import type { GitIdentity } from "./command";
import { abbrev } from "./diff";
import { GitFatal } from "./errors";
import type { Commit, Signature } from "./objects";
import type { Options } from "./options";

/** `git commit -m` cleanup ("whitespace"): trailing spaces, runs of blank lines and blank ends go; "" if nothing is left. */
export function cleanupMessage(text: string): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line === "" && (out.length === 0 || out.at(-1) === "")) continue;
    out.push(line);
  }
  while (out.at(-1) === "") out.pop();
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

/** %s: the first paragraph, its lines joined with a space; trailing spaces go, leading ones stay (git's format_subject). */
export function subjectOf(message: string): string {
  const lines = message.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const para: string[] = [];
  for (; i < lines.length && lines[i]!.trim() !== ""; i++) para.push(lines[i]!.replace(/\s+$/, ""));
  return para.join(" ");
}

/** %b: what follows the subject paragraph. */
export function bodyOf(message: string): string {
  const lines = message.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  while (i < lines.length && lines[i]!.trim() !== "") i++;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  return lines.slice(i).join("\n");
}

const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: .+$/;

/** -s: "Signed-off-by:" joins the message's trailer block if it ends in one, or opens one. */
export function withSignoff(message: string, who: GitIdentity): string {
  const line = `Signed-off-by: ${who.name} <${who.email}>`;
  const paragraphs = message.replace(/\n$/, "").split("\n\n");
  const last = paragraphs.at(-1)!.split("\n");
  const joins = paragraphs.length > 1 && last.every((l) => TRAILER.test(l));
  return joins ? `${message}${line}\n` : `${message}\n${line}\n`;
}

export type DateMode = "default" | "iso" | "short" | "relative" | "unix" | "raw";

export function parseDateMode(value: string | undefined): DateMode {
  if (value === undefined || value === "default" || value === "normal") return "default";
  if (value === "iso" || value === "iso8601") return "iso";
  if (value === "short" || value === "relative" || value === "unix" || value === "raw") return value;
  throw new GitFatal(`fatal: unknown date format ${value}\n`);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number): string => String(n).padStart(2, "0");

function tzSeconds(tz: string): number {
  const sign = tz.startsWith("-") ? -1 : 1;
  return sign * (Number(tz.slice(1, 3)) * 3600 + Number(tz.slice(3, 5)) * 60);
}

export function relativeDate(timestamp: number, now: Date): string {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (timestamp > nowSeconds) return "in the future";
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  let diff = nowSeconds - timestamp;
  if (diff < 90) return ago(diff, "second");
  diff = Math.floor((diff + 30) / 60);
  if (diff < 90) return ago(diff, "minute");
  diff = Math.floor((diff + 30) / 60);
  if (diff < 36) return ago(diff, "hour");
  diff = Math.floor((diff + 12) / 24);
  if (diff < 14) return ago(diff, "day");
  if (diff < 70) return ago(Math.floor((diff + 3) / 7), "week");
  if (diff < 365) return ago(Math.floor((diff + 15) / 30), "month");
  if (diff < 1825) {
    const totalMonths = Math.floor((diff * 12 * 2 + 365) / (365 * 2));
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    return months ? `${years} year${years === 1 ? "" : "s"}, ${ago(months, "month")}` : ago(years, "year");
  }
  return ago(Math.floor((diff + 183) / 365), "year");
}

export function formatDate(s: Signature, mode: DateMode, now: Date): string {
  if (mode === "relative") return relativeDate(s.timestamp, now);
  if (mode === "unix") return String(s.timestamp);
  if (mode === "raw") return `${s.timestamp} ${s.timezone}`;
  const d = new Date((s.timestamp + tzSeconds(s.timezone)) * 1000);
  const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  if (mode === "short") return ymd;
  if (mode === "iso") return `${ymd} ${hms} ${s.timezone}`;
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${hms} ${d.getUTCFullYear()} ${s.timezone}`;
}

function expandTabs(line: string): string {
  let out = "";
  for (const c of line) out += c === "\t" ? " ".repeat(8 - (out.length % 8)) : c;
  return out;
}

/** The message under a medium/full header: 4 spaces before each line (blank ones too), leading blanks dropped; `onlySubject` stops at the first blank line. */
export function indentMessage(message: string, onlySubject = false): string {
  let out = "";
  let first = true;
  for (const raw of message.replace(/\n$/, "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line === "") {
      if (first) continue;
      if (onlySubject) break;
    }
    first = false;
    out += `    ${expandTabs(line)}\n`;
  }
  return out;
}

export type Pretty =
  | { readonly kind: "medium" | "short" | "full" | "fuller" | "oneline" }
  | { readonly kind: "format" | "tformat"; readonly template: string };

const NAMED = new Set(["medium", "short", "full", "fuller", "oneline"]);

function namedOrTemplate(value: string, tformat: boolean): Pretty {
  if (NAMED.has(value)) return { kind: value as "medium" };
  if (value.startsWith("format:")) return { kind: "format", template: value.slice(7) };
  if (value.startsWith("tformat:")) return { kind: "tformat", template: value.slice(8) };
  if (value.includes("%") || tformat) return { kind: "tformat", template: value };
  throw new GitFatal(`fatal: invalid --pretty format: ${value}\n`);
}

export function parsePretty(o: Options): Pretty {
  if (o.has("--oneline")) return { kind: "oneline" };
  const format = o.value("--format");
  if (format !== undefined) return namedOrTemplate(format, true);
  const pretty = o.value("--pretty");
  if (pretty !== undefined) return namedOrTemplate(pretty, false);
  return { kind: "medium" };
}

/** "--pretty" alone means medium; --decorate=short|full is --decorate, =no is --no-decorate. */
export function normalizeLogArgs(args: readonly string[]): string[] {
  return args.map((a) => (a === "--pretty" ? "--pretty=medium" : a === "--decorate=short" || a === "--decorate=full" ? "--decorate" : a === "--decorate=no" ? "--no-decorate" : a));
}

export interface Display {
  readonly pretty: Pretty;
  readonly abbrevCommit: boolean;
  readonly date: DateMode;
  readonly decorate: boolean;
  readonly now: Date;
  /** What each commit is decorated with (`HEAD -> main, otra`), from `decorationsOf`. */
  readonly decorations: ReadonlyMap<string, string>;
}

/** Git's decorations: "HEAD -> <current>" first, then the other branches at that commit, as git lists them
 *  (by name, Z to A). */
export function decorationsOf(state: { readonly head: string; readonly branch: string; readonly refs: Readonly<Record<string, string>> }): Map<string, string> {
  const byCommit = new Map<string, string[]>();
  for (const name of Object.keys(state.refs).sort((a, b) => compareNames(b, a))) {
    if (name === state.branch) continue;
    const oid = state.refs[name]!;
    byCommit.set(oid, [...(byCommit.get(oid) ?? []), name]);
  }
  byCommit.set(state.head, [`HEAD -> ${state.branch}`, ...(byCommit.get(state.head) ?? [])]);
  return new Map([...byCommit].map(([oid, names]) => [oid, names.join(", ")]));
}

export function expandFormat(template: string, oid: string, c: Commit, o: { readonly now: Date; readonly date: DateMode; readonly decoration?: string }): string {
  return template.replace(/%(%|n|H|h|T|t|P|p|an|ae|ad|ar|as|ai|at|cn|ce|cd|cr|cs|ci|ct|s|b|B|d|D|x[0-9a-fA-F]{2})/g, (_m, k: string) => {
    switch (k) {
      case "%": return "%";
      case "n": return "\n";
      case "H": return oid;
      case "h": return abbrev(oid);
      case "T": return c.tree;
      case "t": return abbrev(c.tree);
      case "P": return c.parents.join(" ");
      case "p": return c.parents.map(abbrev).join(" ");
      case "an": return c.author.name;
      case "ae": return c.author.email;
      case "ad": return formatDate(c.author, o.date, o.now);
      case "ar": return relativeDate(c.author.timestamp, o.now);
      case "as": return formatDate(c.author, "short", o.now);
      case "ai": return formatDate(c.author, "iso", o.now);
      case "at": return String(c.author.timestamp);
      case "cn": return c.committer.name;
      case "ce": return c.committer.email;
      case "cd": return formatDate(c.committer, o.date, o.now);
      case "cr": return relativeDate(c.committer.timestamp, o.now);
      case "cs": return formatDate(c.committer, "short", o.now);
      case "ci": return formatDate(c.committer, "iso", o.now);
      case "ct": return String(c.committer.timestamp);
      case "s": return subjectOf(c.message);
      case "b": return bodyOf(c.message);
      case "B": return c.message;
      case "d": return o.decoration ? ` (${o.decoration})` : "";
      case "D": return o.decoration ?? "";
      default: return String.fromCharCode(parseInt(k.slice(1), 16));
    }
  });
}

export function commitHeader(oid: string, c: Commit, d: Display): string {
  const shown = d.abbrevCommit ? abbrev(oid) : oid;
  const decoration = d.decorations.get(oid);
  const decor = d.decorate && decoration ? ` (${decoration})` : "";
  const who = (s: Signature) => `${s.name} <${s.email}>`;
  const date = (s: Signature) => formatDate(s, d.date, d.now);
  switch (d.pretty.kind) {
    case "oneline":
      return `${shown}${decor} ${subjectOf(c.message)}\n`;
    case "short":
      return `commit ${shown}${decor}\nAuthor: ${who(c.author)}\n\n${indentMessage(c.message, true)}`;
    case "medium":
      return `commit ${shown}${decor}\nAuthor: ${who(c.author)}\nDate:   ${date(c.author)}\n\n${indentMessage(c.message)}`;
    case "full":
      return `commit ${shown}${decor}\nAuthor: ${who(c.author)}\nCommit: ${who(c.committer)}\n\n${indentMessage(c.message)}`;
    case "fuller":
      return `commit ${shown}${decor}\nAuthor:     ${who(c.author)}\nAuthorDate: ${date(c.author)}\nCommit:     ${who(c.committer)}\nCommitDate: ${date(c.committer)}\n\n${indentMessage(c.message)}`;
    case "format":
    case "tformat":
      return expandFormat(d.pretty.template, oid, c, { now: d.now, date: d.date, ...(d.decorations.has(oid) ? { decoration: d.decorations.get(oid)! } : {}) });
  }
}
