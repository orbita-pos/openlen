// What a click on the canvas becomes in the chat: the same element mention the
// «@» list would have inserted (spec local 2026-10-27, §6.6). Client-safe.

import type { DesignSelection } from "@/lib/apps/design/types";

import { humanNameOf, kindOf } from "./naming";
import type { MentionKind, MentionRef, MentionSig } from "./types";

const TARGET_TEXT_MAX = 40;

/** What the page canvas's section-select script sends (`openlen:section-selected`). */
export interface PagePick {
  hint: string;
  tag: string;
  path: string;
  /** The element's own text, whitespace collapsed, first 40 characters. */
  text: string;
  /** Its identity when it has no text of its own (`mentionSigOf`). */
  sig?: MentionSig;
}

export function mentionLabel(kindWord: string, name: string): string {
  return `@${kindWord} · ${name}`;
}

export function mentionFromPagePick(pick: PagePick, page: string | null, labels: (kind: MentionKind) => string): MentionRef {
  const tag = pick.tag.toLowerCase();
  const text = pick.text.slice(0, TARGET_TEXT_MAX);
  return {
    type: "element",
    label: mentionLabel(labels(kindOf(tag, {})), humanNameOf({ tag, ownText: text, attrs: {} })),
    text,
    target: { type: "page", page, path: pick.path, tag, ...(text ? { text } : pick.sig ? { sig: pick.sig } : {}) },
  };
}

export function mentionFromDesignSelection(s: DesignSelection, labels: (kind: MentionKind) => string): MentionRef | null {
  const link = s.primary >= 0 ? s.chain[s.primary] : undefined;
  if (!link) return null;
  const text = s.text.replace(/\s+/g, " ").trim().slice(0, TARGET_TEXT_MAX);
  return {
    type: "element",
    label: mentionLabel(labels(kindOf(s.tag, {})), humanNameOf({ tag: s.tag, ownText: text, attrs: {}, component: link.component })),
    text,
    target: {
      type: "app",
      path: link.path,
      line: link.line,
      tag: s.tag,
      ...(text ? { text } : {}),
      ...(s.copies > 1 ? { copies: s.copies } : {}),
      ...(s.screen ? { screen: s.screen } : {}),
    },
  };
}
