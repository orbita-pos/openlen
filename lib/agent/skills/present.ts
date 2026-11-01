/**
 * `present` (spec local 2026-10-26-len-skills, §4.9): DeepSeek Harness's tool to deliver files
 * (`packages/deliverables/tool-present/src/index.ts`, MIT, LICENSES/deepseek-harness.MIT.txt), its
 * description and its limit of 4 per call. In Len the box is ephemeral, so each file is COPIED to the
 * private store as it is when presented (their last sentence changes for that; `deliveries.ts`) and the
 * chat shows a card to download it through the project's route. Never saved to the project or published.
 */
import { ATTACHMENT_KINDS, kindFromName } from "@/lib/projects/chat-files";

import { officePreview, wantsOfficePreview } from "./office-preview";

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";

export const PRESENT_TOOL = "present";
export const PRESENT_MAX_FILES = 4;
export const MAX_DELIVERABLE_BYTES = 20 * 1024 * 1024;

export interface DeliveredFile {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly description?: string;
  /** An Office file's PDF preview, made by LibreOffice in the box (spec local 2026-10-31-len-movil, §5.2). */
  readonly preview?: string;
}

/** What all the Office previews of one `present` call may take together. */
export const OFFICE_PREVIEW_BUDGET_MS = 60_000;

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
            path: { type: "STRING", description: "Path of an existing regular file in the terminal, or of a screenshot this turn kept (the `screenshots` of view_page and use_page). Relative paths start at /." },
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

/**
 * Where a delivered file lives (spec local 2026-10-26-len-skills, §4.9): in the PRIVATE store, under
 * the project and the turn, and the URL of the project's route that serves it to whoever has access
 * (like DeepSeek's host, which exposes the presented file to the session, and Claude's files). `id`
 * keeps two files of the same name apart. Only the file's own name is kept, never a folder.
 */
export function deliverableLocation(projectId: string, turnId: string, name: string, id: string): { key: string; url: string } {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 100);
  const turn = turnId.replace(/[^A-Za-z0-9_-]/g, "") || "turn";
  const file = `${id}-${base || "file"}`;
  return { key: `deliveries/${projectId}/${turn}/${file}`, url: `/api/projects/${encodeURIComponent(projectId)}/deliveries/${turn}/${encodeURIComponent(file)}` };
}

const DELIVERY_URL = /^\/api\/projects\/[A-Za-z0-9_-]{1,64}\/deliveries\/[A-Za-z0-9_-]{1,100}\/[0-9a-f]{8}-[A-Za-z0-9._%-]+$/;

/** The delivered files a saved card may carry; anything else is dropped. Null if none survive. */
export function deliveredFrom(v: unknown): DeliveredFile[] | null {
  if (!Array.isArray(v)) return null;
  const out: DeliveredFile[] = [];
  for (const f of v.slice(0, PRESENT_MAX_FILES)) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name || typeof r.url !== "string" || typeof r.size !== "number" || !Number.isFinite(r.size) || r.size < 0) continue;
    // Only where `present` puts a file (`deliverableLocation`): the project's route, which checks
    // access. Never another site or another page of this one: the chat is shared among the members.
    if (!DELIVERY_URL.test(r.url) || r.url.length > 500) continue;
    const preview = typeof r.preview === "string" && DELIVERY_URL.test(r.preview) && r.preview.length <= 500 ? r.preview : null;
    out.push({
      name: r.name.slice(0, 120),
      url: r.url,
      size: r.size,
      ...(typeof r.description === "string" && r.description ? { description: r.description.slice(0, 300) } : {}),
      ...(preview ? { preview } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

const fail = (error: string): ToolOutcome => ({ response: { ok: false, error } });

export async function toolPresent(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const files = Array.isArray(args.files) ? args.files : [];
  if (files.length < 1 || files.length > PRESENT_MAX_FILES) return fail(`present accepts 1 to ${PRESENT_MAX_FILES} files`);
  // Called THROUGH the terminal: its method needs its own `this` (TurnSandbox), found by a real turn.
  const terminal = session.terminal;
  const fromBox = terminal?.readFileBytes ? (path: string) => terminal.readFileBytes!(path) : undefined;
  // A screenshot view_page or use_page kept this turn, by the path it gave (lib/agent/tools.ts): the
  // evidence reaches the user even when no box ran, as Claude Code's verify sends its screenshots.
  const kept = session.screenshots;
  if (!fromBox && !kept?.size) return fail("There is no file to deliver: no terminal box ran in this turn. Make the file in the terminal first.");
  const read = async (path: string) => kept?.get(path) ?? (fromBox ? fromBox(path) : null);
  // Every file is checked before any is uploaded: a refusal uploads nothing.
  const ready: { name: string; path: string; bytes: Uint8Array; description?: string }[] = [];
  for (const f of files) {
    const raw = typeof (f as { path?: unknown })?.path === "string" ? ((f as { path: string }).path.trim()) : "";
    if (!raw) return fail("Each file needs its path.");
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    const bytes = await read(path).catch(() => null);
    if (!bytes) return fail(`${path} does not exist or is not a file.`);
    if (bytes.byteLength > MAX_DELIVERABLE_BYTES) return fail(`${path} is larger than 20 MB.`);
    const description = typeof (f as { description?: unknown }).description === "string" ? (f as { description: string }).description.trim() : "";
    ready.push({ name: path.split("/").pop()!, path, bytes, ...(description ? { description } : {}) });
  }
  if (!deps.storeDeliverable) return fail("Delivering files isn't available in this environment.");
  // Office files get a PDF preview from the box, all of them within one budget; one that fails or
  // doesn't fit is delivered without it (spec local 2026-10-31-len-movil, §5.2).
  const started = Date.now();
  const previews = new Map<number, Uint8Array>();
  for (const [i, r] of ready.entries()) {
    if (!terminal || !wantsOfficePreview(r.name)) continue;
    const pdf = await officePreview(terminal, r.path, OFFICE_PREVIEW_BUDGET_MS - (Date.now() - started));
    if (pdf) previews.set(i, pdf);
  }
  const turnId = session.turnId ?? "turn";
  const delivered: DeliveredFile[] = [];
  for (const [i, r] of ready.entries()) {
    const { url } = await deps.storeDeliverable(session.projectId, turnId, r.name, r.bytes, contentTypeOf(r.name));
    const pdf = previews.get(i);
    const preview = pdf ? (await deps.storeDeliverable(session.projectId, turnId, `${r.name}.preview.pdf`, pdf, "application/pdf")).url : null;
    delivered.push({ name: r.name, url, size: r.bytes.byteLength, ...(r.description ? { description: r.description } : {}), ...(preview ? { preview } : {}) });
  }
  return { response: { ok: true, files: delivered }, action: { tool: PRESENT_TOOL, ok: true, summary: delivered.map((d) => d.name).join(", ") }, delivered };
}
