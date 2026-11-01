// How the shared viewer shows a delivered file, from its name (spec local 2026-10-31-len-movil, §5.1).
// An SVG goes with the HTML: it can carry script, so it is opened on the canvas host, never inline here.

export type ViewKind = "image" | "video" | "pdf" | "office" | "html" | "text" | "download";

const KINDS: Readonly<Record<string, ViewKind>> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  avif: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  pdf: "pdf",
  pptx: "office",
  docx: "office",
  xlsx: "office",
  xlsm: "office",
  csv: "office",
  html: "html",
  htm: "html",
  svg: "html",
  txt: "text",
  md: "text",
  json: "text",
};

export function viewKindOf(name: string): ViewKind {
  return KINDS[/\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "download";
}
