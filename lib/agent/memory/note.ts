/**
 * UNA NOTA DE MEMORIA — el formato de Claude Code: un hecho por fichero, con
 * frontmatter (`name`, `description`, `type`) y el porqué en el cuerpo.
 *
 * Tres tipos, los de Claude Code menos `user`: lo de la persona es privado y
 * va en su `~/.len/LEN.md`; estas notas son del PROYECTO y las ven sus
 * miembros (el «team memory» de Claude Code).
 *
 * El índice (`MEMORY.md`) no lo escribe Len: lo genera el servidor de las
 * notas, así que no puede desincronizarse (plans/len-md).
 *
 * Puro.
 */
import { NOTE_NAME, NOTE_NAME_MAX } from "@/lib/agent/ficheros/len-md";
import { findSecret } from "./secrets";

export const NOTE_TYPES = ["feedback", "project", "reference"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export interface MemoryNote {
  readonly name: string;
  readonly description: string;
  readonly type: NoteType;
  readonly body: string;
}

export const NOTE_DESCRIPTION_MAX = 150;
export const NOTE_BODY_MAX = 2_000;
export const MAX_NOTES_PER_PROJECT = 100;
export const MEMORY_INDEX_MAX = 4_000;

export function serializeNote(note: MemoryNote): string {
  return `---\nname: ${note.name}\ndescription: ${note.description}\ntype: ${note.type}\n---\n\n${note.body}\n`;
}

function template(name: string): string {
  return serializeNote({
    name,
    description: "<one line: what this is, specific enough to decide later if it is relevant>",
    type: "feedback",
    body: "<the fact. For feedback and project, then **Why:** and **How to apply:** lines>",
  });
}

export function parseNote(text: string, expectedName: string): { ok: true; note: MemoryNote } | { ok: false; error: string } {
  const t = text.replace(/\r\n/g, "\n");
  const fail = (why: string) => ({ ok: false as const, error: `${why} A memory note looks like this:\n${template(expectedName)}` });
  if (!t.startsWith("---\n")) return fail("The note has no frontmatter.");
  const end = t.indexOf("\n---\n", 4);
  if (end < 0) return fail("The frontmatter is not closed with ---.");
  const fields = new Map<string, string>();
  for (const line of t.slice(4, end).split("\n")) {
    const m = /^([a-z]+):\s*(.*)$/.exec(line);
    if (m) fields.set(m[1]!, m[2]!.trim());
  }
  const name = fields.get("name") ?? "";
  const description = fields.get("description") ?? "";
  const type = fields.get("type") ?? "";
  const body = t.slice(end + "\n---\n".length).trim();
  if (name !== expectedName) return fail(`name must be "${expectedName}", the file's name.`);
  if (!NOTE_NAME.test(name) || name.length > NOTE_NAME_MAX) {
    return fail(`name must be lowercase words joined by "-", up to ${NOTE_NAME_MAX} characters.`);
  }
  if (type === "user") {
    return { ok: false, error: "What you learn about the person goes in ~/.len/LEN.md (private to them), not in the project's notes." };
  }
  if (!(NOTE_TYPES as readonly string[]).includes(type)) return fail(`type must be one of: ${NOTE_TYPES.join(", ")}.`);
  if (!description || description.length > NOTE_DESCRIPTION_MAX) {
    return fail(`description is one line of 1 to ${NOTE_DESCRIPTION_MAX} characters.`);
  }
  if (!body || body.length > NOTE_BODY_MAX) return fail(`The body is 1 to ${NOTE_BODY_MAX} characters: one fact per note.`);
  const secret = findSecret(`${description}\n${body}`);
  if (secret) {
    return { ok: false, error: `The note seems to contain a ${secret}. Memory is shown to everyone on the project: never save credentials in it.` };
  }
  return { ok: true, note: { name, description, type: type as NoteType, body } };
}

const INDEX_HEADER = "# Memory index — generated from the notes in /.len/memory/, read-only\n";

/** `MEMORY.md`: una línea por nota, en el orden dado (la más nueva primero). */
export function buildMemoryIndex(notes: readonly Pick<MemoryNote, "name" | "description" | "type">[], maxChars: number): string {
  if (notes.length === 0) return "";
  let out = INDEX_HEADER;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const line = `- [${n.name}](${n.name}.md) (${n.type}) — ${n.description}\n`;
    const rest = notes.length - i;
    const tail = `- …and ${rest} more: ls -a /.len/memory\n`;
    if (out.length + line.length + (rest > 1 ? tail.length : 0) > maxChars) return out + tail;
    out += line;
  }
  return out;
}
