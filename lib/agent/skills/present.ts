/**
 * `present` (spec local 2026-10-26-len-skills, §4.9): DeepSeek Harness's tool to deliver files
 * (`packages/deliverables/tool-present/src/index.ts`, MIT, LICENSES/deepseek-harness.MIT.txt), its
 * description and its limit of 4 per call. In Len the box is ephemeral, so each file is COPIED to
 * storage as it is when presented (their last sentence changes for that) and the chat shows a card to
 * download it. Never saved to the project or published.
 */
import { ATTACHMENT_KINDS, kindFromName } from "@/lib/projects/chat-files";

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";

export const PRESENT_TOOL = "present";
export const PRESENT_MAX_FILES = 4;
export const MAX_DELIVERABLE_BYTES = 20 * 1024 * 1024;

export interface DeliveredFile {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly description?: string;
}

export const DECLARACION_PRESENT = {
  name: PRESENT_TOOL,
  description:
    "Declare existing files as final deliverables for the user. Hosts may show presented files only after your turn ends, so call it once the files are final. If the user needs to review files earlier, such as before a tool call that waits for their answer, link them in your message instead. Use it when the user needs a separate file, especially Office documents, spreadsheets, and slide decks; prefer your final response when that suffices. The user gets a copy of each file as it is when you call it.",
  parameters: {
    type: "OBJECT",
    properties: {
      files: {
        type: "ARRAY",
        description: "Usually the 1-2 most important deliverables; at most 4 per call.",
        items: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "Path of an existing regular file in the terminal. Relative paths start at /." },
            description: { type: "STRING", description: "Brief description for the user." },
          },
          required: ["path"],
        },
      },
    },
    required: ["files"],
  },
} as const;

const EXTRA_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain", md: "text/markdown", json: "application/json", zip: "application/zip" };

export function contentTypeOf(name: string): string {
  const kind = kindFromName(name);
  if (kind) return ATTACHMENT_KINDS[kind].mime;
  return EXTRA_TYPES[/\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** The delivered files a saved card may carry; anything else is dropped. Null if none survive. */
export function deliveredFrom(v: unknown): DeliveredFile[] | null {
  if (!Array.isArray(v)) return null;
  const out: DeliveredFile[] = [];
  for (const f of v.slice(0, PRESENT_MAX_FILES)) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name || typeof r.url !== "string" || typeof r.size !== "number" || !Number.isFinite(r.size) || r.size < 0) continue;
    // An absolute http(s) URL, or a path of THIS site: one "/" and never "//" or "/\", which browsers
    // read as another site (the chat is shared among the project's members).
    if (!/^(https?:\/\/|\/(?![/\\]))/.test(r.url) || r.url.length > 500) continue;
    out.push({ name: r.name.slice(0, 120), url: r.url, size: r.size, ...(typeof r.description === "string" && r.description ? { description: r.description.slice(0, 300) } : {}) });
  }
  return out.length > 0 ? out : null;
}

const fail = (error: string): ToolOutcome => ({ response: { ok: false, error } });

export async function toolPresent(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const files = Array.isArray(args.files) ? args.files : [];
  if (files.length < 1 || files.length > PRESENT_MAX_FILES) return fail(`present accepts 1 to ${PRESENT_MAX_FILES} files`);
  // Called THROUGH the terminal: its method needs its own `this` (TurnSandbox), found by a real turn.
  const terminal = session.terminal;
  const read = terminal?.readFileBytes ? (path: string) => terminal.readFileBytes!(path) : undefined;
  if (!read) return fail("There is no file to deliver: no terminal box ran in this turn. Make the file in the terminal first.");
  // Every file is checked before any is uploaded: a refusal uploads nothing.
  const ready: { name: string; bytes: Uint8Array; description?: string }[] = [];
  for (const f of files) {
    const raw = typeof (f as { path?: unknown })?.path === "string" ? ((f as { path: string }).path.trim()) : "";
    if (!raw) return fail("Each file needs its path.");
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    const bytes = await read(path).catch(() => null);
    if (!bytes) return fail(`${path} does not exist or is not a file.`);
    if (bytes.byteLength > MAX_DELIVERABLE_BYTES) return fail(`${path} is larger than 20 MB.`);
    const description = typeof (f as { description?: unknown }).description === "string" ? (f as { description: string }).description.trim() : "";
    ready.push({ name: path.split("/").pop()!, bytes, ...(description ? { description } : {}) });
  }
  if (!deps.storeDeliverable) return fail("Delivering files isn't available in this environment.");
  const delivered: DeliveredFile[] = [];
  for (const r of ready) {
    const { url } = await deps.storeDeliverable(session.projectId, session.turnId ?? "turn", r.name, r.bytes, contentTypeOf(r.name));
    delivered.push({ name: r.name, url, size: r.bytes.byteLength, ...(r.description ? { description: r.description } : {}) });
  }
  return { response: { ok: true, files: delivered }, action: { tool: PRESENT_TOOL, ok: true, summary: delivered.map((d) => d.name).join(", ") }, delivered };
}
