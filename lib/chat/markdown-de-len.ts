// What Len writes, read as real Markdown (A8 of Len 3.1, DeepSeek's `web-assistant-markdown`, MIT):
// `mdast-util-from-markdown` with the GFM extensions — CommonMark blocks, tables, task lists,
// strikethrough, autolinks — and no HTML parser in the pipeline, so raw HTML stays inert text. The
// tree is painted by `components/workspace-v2/texto-de-len.tsx`. It replaces the hand formatter of
// 23/09 (`formato-de-len.ts`), which painted only bold, italics, code and links: lists, in 44 % of
// Len's turns in October, came out as raw text. Pure and client-safe. Only Len's text: what a person
// writes stays literal, as in DeepSeek.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Root } from "mdast";

export function parseLenMarkdown(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** DeepSeek's untrusted-output policy: a destination opens only when it is an absolute http(s) or
 *  mailto URL. A relative one, `javascript:` or anything else is not a link. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(url.trim()) ? url.trim() : null;
}

/** A code span that is, entirely, an absolute http(s) URL opens it (DeepSeek's rule); a command, a
 *  partial URL or another scheme stays code. */
export function wholeHttpUrl(code: string): string | null {
  return /^https?:\/\/[^\s`]+$/i.test(code) ? code : null;
}
