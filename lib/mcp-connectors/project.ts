// WHAT LEN READS BACK FROM A CONNECTOR (spec local 2026-11-06-conectores-mcp, §5.5), DeepSeek's projection: text blocks
// joined in order, a resource link as its name and URI, an image as an image when the turn's model takes images,
// everything else (audio, embedded resources, unknown blocks) as a plain diagnostic — never silence. `isError` is a
// visible failure, its text redacted of every key the call sent; a success is left as the server wrote it. Cut at
// 30 KB like an installed tool's operation. Pure.
import type { InlineImage } from "@/lib/ai-gateway";
import type { McpCallResult } from "@/lib/tools/mcp/client";
import { capped } from "@/lib/tools/mcp/operations";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function projectCallResult(
  result: McpCallResult,
  redact: (s: string) => string,
  imagesOk: boolean,
): { response: Record<string, unknown>; images?: InlineImage[] } {
  const lines: string[] = [];
  const images: InlineImage[] = [];
  for (const block of result.content ?? []) {
    const b = (block && typeof block === "object" ? block : {}) as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") lines.push(b.text);
    else if (b.type === "resource_link") lines.push(`${String(b.name ?? b.uri ?? "")} (${String(b.uri ?? "")})`);
    else if (b.type === "image" && typeof b.mimeType === "string" && typeof b.data === "string" && IMAGE_TYPES.has(b.mimeType)) {
      if (imagesOk) {
        images.push({ mimeType: b.mimeType, dataBase64: b.data });
        lines.push(`[image ${images.length}: ${b.mimeType}, attached]`);
      } else lines.push(`[image: ${b.mimeType}, not shown]`);
    } else lines.push(`[${typeof b.type === "string" ? b.type : "unknown"} content: not shown]`);
  }
  const text = lines.join("\n");
  if (result.isError) return { response: capped({ content: [{ type: "text", text: redact(text) }], isError: true }) };
  const response = capped({ content: [{ type: "text", text }], ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}) });
  return images.length > 0 ? { response, images } : { response };
}

function withoutBlobs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutBlobs);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) =>
      k === "blob" && typeof x === "string" ? [k, `[binary resource: ${x.length} base64 characters; available to programmatic callers]`] : [k, withoutBlobs(x)],
    ),
  );
}

/** DeepSeek's resource rendering: `MCP server: <server>` and the JSON, with every string blob described. */
export function renderResource(server: string, json: unknown): string {
  return `MCP server: ${server}\n${JSON.stringify(withoutBlobs(json), null, 2)}`;
}
