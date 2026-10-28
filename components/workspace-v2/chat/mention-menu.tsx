// THE CHAT'S «@» (spec local 2026-10-27-at-mentions, §6): typing «@» opens a
// list of everything that can be pointed at — the people (team chat), the
// elements of the page or the app, the files — and «pick on the canvas…» last.
// Moving through it outlines the element on the canvas; Enter leaves a mention
// in the text. Built on the team chat's «@» (`useArroba`): same trigger, same
// keys, same painted tokens in the box.
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronRight, Crosshair, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { arrobaEnCurso, opcionesDeMencion, type PersonaMencionable } from "@/lib/workspace-v2/menciones";
import { mentionLabel } from "@/lib/mentions/from-pick";
import { liveMentions, sameMention } from "@/lib/mentions/in-text";
import { searchMentions } from "@/lib/mentions/search";
import { MAX_MENTIONS, type MentionEntry, type MentionRef } from "@/lib/mentions/types";
import { highlightOnCanvas, mentionCanvasPage, onMentionHighlighted } from "../mention-highlight";

/** How many matches the list shows before «N more — keep typing». */
const SHOWN = 40;
/** The longest «@…» still read as a search, like the team chat's. */
const QUERY_MAX = 40;

export interface MentionIndex {
  entries: readonly MentionEntry[];
  files: readonly string[];
}

type Row =
  | { kind: "person"; label: string; userId: string | null }
  | { kind: "element"; entry: MentionEntry; depth: number; hasChildren: boolean; open: boolean }
  | { kind: "file"; ruta: string }
  | { kind: "canvas" };

/** Where the «@» being typed starts, or null. Spaces are allowed once the search
 *  is under way; a mention already in the text is never re-opened. */
function sessionAt(value: string, cursor: number, labels: readonly string[], people: readonly PersonaMencionable[]): { at: number; query: string } | null {
  const word = arrobaEnCurso(value, cursor);
  if (word) return { at: word.desde, query: word.busca };
  const at = value.lastIndexOf("@", cursor - 1);
  if (at === -1 || (at > 0 && !/\s/.test(value[at - 1]!))) return null;
  const query = value.slice(at + 1, cursor);
  // «@ » is not a mention, like in Claude Code: a space right after it closes it.
  if (query.length > QUERY_MAX || query.includes("\n") || /^\s/.test(query)) return null;
  const rest = value.slice(at);
  if (labels.some((l) => rest.startsWith(l))) return null;
  if (["Len", ...people.map((p) => p.nombre)].some((n) => rest.toLowerCase().startsWith(`@${n.toLowerCase()} `))) return null;
  return { at, query };
}

function basename(ruta: string): string {
  return ruta.slice(ruta.lastIndexOf("/") + 1);
}

export function useMentionMenu(args: {
  value: string;
  setValue: (t: string) => void;
  ref: React.RefObject<HTMLTextAreaElement | null>;
  people: readonly PersonaMencionable[];
  withLen: boolean;
  colorOf?: (userId: string) => string;
  /** Without an index there is no «@» of elements (and the team chat's own «@» runs). */
  index: MentionIndex | null;
  mentions: readonly MentionRef[];
  onMentionsChange: (m: MentionRef[]) => void;
  onPickOnCanvas?: () => void;
}) {
  const { value, setValue, ref, people, withLen, colorOf, index, mentions, onMentionsChange, onPickOnCanvas } = args;
  const t = useTranslations("panelsChat");
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const caretAfter = useRef<number | null>(null);
  const labels = useMemo(() => mentions.map((m) => m.label), [mentions]);

  useLayoutEffect(() => {
    if (caretAfter.current === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  });
  useEffect(() => onMentionHighlighted((key, count) => setCounts((c) => (c[key] === count ? c : { ...c, [key]: count }))), []);
  // A mention whose label is no longer in the text is gone.
  useEffect(() => {
    const still = liveMentions(value, mentions);
    if (still.length !== mentions.length) onMentionsChange(still);
  }, [value, mentions, onMentionsChange]);

  const session = index ? sessionAt(value, cursor, labels, people) : null;
  const open = session !== null && session.at !== dismissedAt;
  useEffect(() => {
    if (dismissedAt !== null && value[dismissedAt] !== "@") setDismissedAt(null);
  }, [value, dismissedAt]);

  const { rows, more } = useMemo((): { rows: Row[]; more: number } => {
    let more = 0;
    if (!open || !index || !session) return { rows: [], more };
    const q = session.query;
    const out: Row[] = [];
    if ((people.length > 0 || withLen) && !q.includes(" ")) {
      for (const o of opcionesDeMencion(q, people, withLen)) out.push({ kind: "person", label: o.etiqueta, userId: o.userId });
    }
    if (q.trim() === "") {
      // The tree: what is visible (wrappers folded away), sections folded until opened.
      const byKey = new Map(index.entries.map((e) => [e.key, e]));
      const visibleParent = (e: MentionEntry): string | null => {
        let p = e.parent ? byKey.get(e.parent) : undefined;
        while (p && p.collapsed) p = p.parent ? byKey.get(p.parent) : undefined;
        return p ? p.key : null;
      };
      const children = new Map<string | null, MentionEntry[]>();
      for (const e of index.entries) {
        if (e.collapsed) continue;
        const p = visibleParent(e);
        children.set(p, [...(children.get(p) ?? []), e]);
      }
      const walk = (parent: string | null, depth: number) => {
        for (const e of children.get(parent) ?? []) {
          const hasChildren = (children.get(e.key)?.length ?? 0) > 0;
          const isOpen = expanded.has(e.key);
          out.push({ kind: "element", entry: e, depth, hasChildren, open: isOpen });
          if (isOpen) walk(e.key, depth + 1);
        }
      };
      walk(null, 0);
      for (const ruta of index.files) out.push({ kind: "file", ruta });
    } else {
      // With spaces, every word has to be there whole: otherwise ordinary prose
      // after an unpicked «@» keeps matching something and Enter would pick it.
      const found = searchMentions(index.entries, index.files, q, SHOWN, { strict: /\s/.test(q.trim()) });
      more = found.more;
      for (const r of found.items) {
        out.push(r.type === "element" ? { kind: "element", entry: r.entry, depth: 0, hasChildren: false, open: false } : { kind: "file", ruta: r.ruta });
      }
      // Nothing real found: the menu closes, so Enter sends what was typed.
      if (out.length === 0) return { rows: [], more: 0 };
    }
    if (onPickOnCanvas) out.push({ kind: "canvas" });
    return { rows: out, more };
  }, [open, index, session?.query, people, withLen, expanded, onPickOnCanvas]); // eslint-disable-line react-hooks/exhaustive-deps
  const atLimit = mentions.length >= MAX_MENTIONS;

  useEffect(() => setActive(0), [session?.query, open]);
  const current = rows[Math.min(active, rows.length - 1)];

  // The canvas outlines the active element; nothing when the menu is closed.
  const lit = useRef<string | null>(null);
  const canvasPage = mentionCanvasPage();
  const activeElement = current?.kind === "element" ? current.entry : null;
  const offPage = activeElement?.target.type === "page" && canvasPage !== undefined && activeElement.target.page !== canvasPage;
  useEffect(() => {
    const key = activeElement && !offPage ? activeElement.key : null;
    if (lit.current && lit.current !== key) highlightOnCanvas(lit.current, null);
    if (key && activeElement && lit.current !== key) highlightOnCanvas(key, activeElement.target);
    lit.current = key;
  }, [activeElement, offPage]);
  useEffect(() => () => {
    if (lit.current) highlightOnCanvas(lit.current, null);
  }, []);

  const replaceQuery = (insert: string) => {
    if (!session) return;
    const before = value.slice(0, session.at);
    const after = value.slice(cursor);
    caretAfter.current = before.length + insert.length;
    setValue(before + insert + after);
    setCursor(before.length + insert.length);
  };

  const pick = (row: Row) => {
    if (!session) return;
    if (row.kind === "person") return replaceQuery(`@${row.label} `);
    if (row.kind === "canvas") {
      replaceQuery("");
      onPickOnCanvas?.();
      return;
    }
    if (atLimit) return;
    const ref: MentionRef =
      row.kind === "file"
        ? { type: "file", label: `@${row.ruta}`, ruta: row.ruta }
        : {
            type: "element",
            label: mentionLabel(t(`mentions.kind.${row.entry.kind}`), row.entry.name),
            text: row.entry.text.slice(0, 40),
            target:
              row.entry.target.type === "app"
                ? {
                    ...row.entry.target,
                    // What the canvas counted (a loop, a reused component) and the screen from the routes.
                    ...((counts[row.entry.key] ?? 0) > 1 ? { copies: counts[row.entry.key] } : {}),
                    ...(row.entry.screen ? { screen: row.entry.screen } : {}),
                  }
                : row.entry.target,
          };
    replaceQuery(`${ref.label} `);
    // The same thing picked again: its label goes in the text, the mention stays one.
    if (!mentions.some((m) => sameMention(m, ref))) onMentionsChange([...mentions, ref]);
  };

  const key = (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || rows.length === 0) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      setDismissedAt(session!.at);
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
      return true;
    }
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && current?.kind === "element" && current.hasChildren) {
      e.preventDefault();
      const k = current.entry.key;
      setExpanded((s) => {
        const n = new Set(s);
        if (e.key === "ArrowRight") n.add(k);
        else n.delete(k);
        return n;
      });
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      // Past the limit an element or a file cannot be picked: the menu only
      // says so, and Enter does what it does without a menu — it sends.
      if (atLimit && (current?.kind === "element" || current?.kind === "file")) return false;
      e.preventDefault();
      if (current) pick(current);
      return true;
    }
    return false;
  };

  const status = (entry: MentionEntry): string | null => {
    if (entry.target.type === "page" && canvasPage !== undefined && entry.target.page !== canvasPage) {
      return t("mentions.onPage", { page: entry.target.page ? `/${entry.target.page}` : "/" });
    }
    const c = counts[entry.key];
    if (c === 0) return entry.screen ? t("mentions.onScreen", { screen: entry.screen }) : t("mentions.notOnScreen");
    if (c !== undefined && c > 1) return `×${c}`;
    return null;
  };

  const menu: ReactNode =
    open && rows.length > 0 ? (
      <div role="listbox" data-mention-menu="" className="mention-menu nice-scroll max-h-[320px] overflow-y-auto rounded-[10px] border bd bg-app py-1 shadow-sm">
        {atLimit && <div className="mention-menu-note px-2.5 py-1.5 text-[11.5px] fg-muted">{t("mentions.limit", { max: MAX_MENTIONS })}</div>}
        {rows.map((row, i) => {
          const selected = row === current;
          const common = {
            role: "option" as const,
            "aria-selected": selected,
            onMouseEnter: () => setActive(i),
            onMouseDown: (e: React.MouseEvent) => {
              e.preventDefault();
              pick(row);
            },
            className: `mention-row ${selected ? "mention-row-active" : ""}`,
          };
          if (row.kind === "person") {
            return (
              <div key={`p:${row.userId ?? "len"}`} {...common}>
                <span className={row.userId ? "font-medium" : "font-medium text-accent"} style={row.userId && colorOf ? { color: colorOf(row.userId) } : undefined}>
                  @{row.label}
                </span>
              </div>
            );
          }
          if (row.kind === "canvas") {
            return (
              <div key="canvas" {...common}>
                <Crosshair size={13} className="shrink-0 fg-muted" />
                <span>{t("mentions.pickOnCanvas")}</span>
              </div>
            );
          }
          if (row.kind === "file") {
            return (
              <div key={`f:${row.ruta}`} {...common}>
                <FileText size={13} className="shrink-0 fg-muted" />
                <span className="mention-row-mono truncate">{row.ruta}</span>
              </div>
            );
          }
          const e = row.entry;
          const note = status(e);
          return (
            <div key={e.key} {...common} style={{ paddingLeft: 10 + row.depth * 14 }}>
              <span className="w-3 shrink-0">{row.hasChildren && <ChevronRight size={12} className={`fg-faint transition ${row.open ? "rotate-90" : ""}`} />}</span>
              <span className={`mention-kind mention-kind-${e.kind}`}>{t(`mentions.kind.${e.kind}`)}</span>
              <span className="min-w-0 truncate">{e.name}</span>
              <span className="mention-row-mono ml-auto shrink-0">{e.target.type === "app" ? `${basename(e.ruta)}:${e.line}` : e.tag}</span>
              {note && <span className="shrink-0 text-[11px] fg-faint">{note}</span>}
            </div>
          );
        })}
        {more > 0 && <div className="mention-menu-note px-2.5 py-1 text-[11px] fg-faint">{t("mentions.more", { count: more })}</div>}
      </div>
    ) : null;

  return {
    menu,
    key,
    labels,
    onCursor: (e: { currentTarget: HTMLTextAreaElement }) => setCursor(e.currentTarget.selectionStart ?? 0),
  };
}
