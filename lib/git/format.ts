// How git writes and reads commit messages.
import type { GitIdentity } from "./command";

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
