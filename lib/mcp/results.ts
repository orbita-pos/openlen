// La forma de lo que devuelve una herramienta. UN solo bloque de texto (Claude
// Code por HTTP sólo enseña el primero) y, si hay captura, la imagen delante.
// Nada de `structuredContent`: Codex descarta las imágenes cuando lo hay.

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function imageResult(image: { mimeType: string; dataBase64: string }, text: string): ToolResult {
  return {
    content: [
      { type: "image", data: image.dataBase64, mimeType: image.mimeType },
      { type: "text", text },
    ],
  };
}

/** Un error que el modelo puede ACTUAR: qué pasó y qué hacer. Nunca «Internal Server Error» a secas. */
export function toolError(code: string, message: string): ToolResult {
  return { content: [{ type: "text", text: `Error (${code}): ${message}` }], isError: true };
}
