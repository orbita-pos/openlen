"use client";

/**
 * THE CHAT'S `/` MENU (spec local 2026-10-26-len-skills, §4.5): typing `/` at the start of a word
 * lists the skills the person can invoke, like Claude Code's `/` menu and DeepSeek's `skills/list`;
 * picking one leaves the literal "/name " in the box, and the server does the rest (DeepSeek: the
 * prompt ships the reference verbatim). Shaped like the `@` of the team chat (`useArroba`).
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";

export interface MenuSkill {
  readonly name: string;
  readonly description: string;
  /** Whose it is (`GET /api/projects/[id]/skills`): `bundled` is OpenLen's own. */
  readonly scope?: string;
}

/** What the menu says of a skill. Like Claude Code's `/` menu, its own description, as its author wrote it;
 *  OpenLen's own skills, whose descriptions are written for Len (in English), say it in the person's language
 *  (`composer.skillDescriptions`, one line per skill). Their names are reserved, so a project's skill never
 *  borrows one. */
export function menuDescription(s: MenuSkill, t: { has(key: string): boolean; (key: string): string }): string {
  const key = `composer.skillDescriptions.${s.name}`;
  return s.scope === "bundled" && t.has(key) ? t(key) : s.description;
}

/** The `/word` being typed at the cursor: a `/` at the start or after a space, and what follows. */
export function slashInProgress(text: string, cursor: number): { from: number; query: string } | null {
  const before = text.slice(0, cursor);
  const m = /(^|\s)\/([a-z0-9-]*)$/.exec(before);
  if (!m) return null;
  return { from: before.length - m[2]!.length - 1, query: m[2]! };
}

export function skillOptions(query: string, skills: readonly MenuSkill[]): MenuSkill[] {
  return skills.filter((s) => s.name.startsWith(query));
}

export function useSkillSlash(text: string, setText: (t: string) => void, ref: RefObject<HTMLTextAreaElement | null>, skills: readonly MenuSkill[]) {
  const t = useTranslations("panelsChat");
  const [cursor, setCursor] = useState(0);
  const [chosen, setChosen] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const toPlace = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (toPlace.current === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(toPlace.current, toPlace.current);
    toPlace.current = null;
  });
  const typing = skills.length > 0 ? slashInProgress(text, cursor) : null;
  const open = typing !== null && typing.from !== closedAt;
  const options = open ? skillOptions(typing.query, skills) : [];
  useEffect(() => setChosen(0), [typing?.query]);
  // Like Claude Code's `/` menu, the visible window follows the chosen skill: the list scrolls just enough
  // to keep it in view (only the list, never the chat around it).
  const listRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const item = list?.children[chosen] as HTMLElement | undefined;
    if (!list || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [chosen, open, options.length]);
  useEffect(() => {
    if (typing === null) setClosedAt(null);
  }, [typing]);
  const pick = (name: string) => {
    if (!typing) return;
    const inserted = `/${name} `;
    const next = text.slice(0, typing.from) + inserted + text.slice(cursor);
    toPlace.current = typing.from + inserted.length;
    setText(next);
    setCursor(typing.from + inserted.length);
  };
  /** `true` if the key was the menu's (nothing else should happen with it). */
  const tecla = (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      setClosedAt(typing.from);
      return true;
    }
    if (options.length === 0) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setChosen((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(options[chosen]!.name);
      return true;
    }
    return false;
  };
  const menu: ReactNode = !open ? null : options.length === 0 ? (
    <span className="mt-1 block rounded-md border bd bg-app px-2 py-1 text-[11.5px] fg-muted shadow-sm">{t("composer.noSkills")}</span>
  ) : (
    <span ref={listRef} role="listbox" aria-label={t("composer.skills")} className="relative mt-1 block max-h-56 overflow-y-auto rounded-md border bd bg-app shadow-sm nice-scroll">
      {options.map((o, i) => (
        <button
          key={o.name}
          type="button"
          role="option"
          aria-selected={i === chosen}
          onMouseDown={(e) => {
            e.preventDefault();
            pick(o.name);
          }}
          className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-[11.5px] ${i === chosen ? "bg-hover fg" : "fg-muted"}`}
        >
          <span className="shrink-0 font-medium text-accent">/{o.name}</span>
          <span className="min-w-0 truncate">{menuDescription(o, t)}</span>
        </button>
      ))}
    </span>
  );
  return { onSeleccion: (e: { currentTarget: HTMLTextAreaElement }) => setCursor(e.currentTarget.selectionStart ?? 0), tecla, menu };
}
