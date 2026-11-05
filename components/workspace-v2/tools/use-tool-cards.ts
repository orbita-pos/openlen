"use client";
// THE CHAT'S «CREAR» CARDS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): one store per page, outside
// React like `subagentsLive`, so the card under each answer and the panel read the same cards. Fed by the stream's
// `tool_card` (the card shows before any fetch) and by GET /api/tool-cards — on load, every 60 s, every 5 s while one
// is creating or installing, and when a turn ends.
import { useEffect, useRef, useSyncExternalStore } from "react";

import { notifyCreditBalanceChanged } from "@/lib/credits-client";
import { toolCardFrom as cardFrom } from "@/lib/tools/cards/parse";
import type { ToolCardPhase, ToolCardView } from "@/lib/tools/cards/types";

import { announceToolsChanged } from "./use-installed-tools";

const WORKING: readonly ToolCardPhase[] = ["creating", "installing"];
const LOOK_EVERY_MS = 60_000;
const LOOK_WHILE_WORKING_MS = 5_000;
const DEFAULT_CAP_CREDITS = 25;

let cards: ReadonlyMap<string, ToolCardView & { projectId: string }> = new Map();
let cap = DEFAULT_CAP_CREDITS;
const listeners = new Set<() => void>();

/** Phases where the person's installed tools changed: the rail and «Abrir» must hear it. */
const TOOLS_CHANGE: readonly ToolCardPhase[] = ["installed", "removed"];

function put(projectId: string, next: readonly ToolCardView[]): void {
  if (next.length === 0) return;
  const m = new Map(cards);
  let toolsChanged = false;
  let creatorSettled = false;
  for (const c of next) {
    const prev = cards.get(c.id);
    // A card seen moving into installed or removed (not one first seen that way, as on a reload).
    if (prev && prev.phase !== c.phase && TOOLS_CHANGE.includes(c.phase)) toolsChanged = true;
    // A card leaving creating: its creator settled, and was charged, in the background — the balance must hear it.
    if (prev?.phase === "creating" && c.phase !== "creating") creatorSettled = true;
    m.set(c.id, { ...c, projectId });
  }
  cards = m;
  for (const l of listeners) l();
  if (toolsChanged) announceToolsChanged();
  if (creatorSettled) notifyCreditBalanceChanged();
}

export const toolCardsLive = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: (): ReadonlyMap<string, ToolCardView & { projectId: string }> => cards,
  /** The stream's `tool_card`: Len proposed it in this turn. */
  event(projectId: string, v: unknown): void {
    const c = cardFrom(v);
    if (c) put(projectId, [c]);
  },
  fromServer(projectId: string, list: unknown): void {
    if (Array.isArray(list)) put(projectId, list.flatMap((v) => cardFrom(v) ?? []));
  },
  /** The cards under one answer, oldest first. */
  of(projectId: string, rowId: string): ToolCardView[] {
    return [...cards.values()].filter((c) => c.projectId === projectId && c.chatRowId === rowId);
  },
  working(projectId: string): boolean {
    for (const c of cards.values()) if (c.projectId === projectId && WORKING.includes(c.phase)) return true;
    return false;
  },
  /** What one creation may spend, in credits (`OPENLEN_TOOL_CREATION_CAP`), as the server said. */
  capCredits: (): number => cap,
  /** For tests. */
  forget(): void {
    cards = new Map();
    cap = DEFAULT_CAP_CREDITS;
    for (const l of listeners) l();
  },
};

async function load(projectId: string): Promise<void> {
  try {
    const res = await fetch(`/api/tool-cards?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) return;
    const body = (await res.json()) as { cards?: unknown; capCredits?: unknown };
    if (typeof body.capCredits === "number" && Number.isFinite(body.capCredits) && body.capCredits > 0) cap = body.capCredits;
    toolCardsLive.fromServer(projectId, body.cards);
  } catch {
    // Nothing this time; the next look reads again.
  }
}

/** Keeps the project's cards fresh while the chat is open. */
export function useToolCards(projectId: string, busy: boolean): void {
  const working = useSyncExternalStore(toolCardsLive.subscribe, () => toolCardsLive.working(projectId), () => false);
  useEffect(() => {
    void load(projectId);
  }, [projectId]);
  useEffect(() => {
    const every = setInterval(() => void load(projectId), working ? LOOK_WHILE_WORKING_MS : LOOK_EVERY_MS);
    return () => clearInterval(every);
  }, [projectId, working]);
  // A turn that ends may be the one that proposed a card, or changed one.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void load(projectId);
    wasBusy.current = busy;
  }, [busy, projectId]);
}

export type ToolCardPressResult = { status: "accepted" } | { status: "settled"; card: ToolCardView } | { status: "refused"; reason: string };

/** A press on a card: the verb, with the person's language and zone (the creation's host turn runs in them). */
export async function pressToolCard(
  projectId: string,
  cardId: string,
  verb: string,
  payload: Record<string, unknown> | undefined,
  who: { locale: string; timeZone: string },
): Promise<ToolCardPressResult> {
  try {
    const res = await fetch(`/api/tool-cards/${encodeURIComponent(cardId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verb, ...(payload ? { payload } : {}), locale: who.locale, timeZone: who.timeZone }),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: unknown; card?: unknown; reason?: unknown };
    if (body.status === "settled") {
      const c = cardFrom(body.card);
      if (c) put(projectId, [c]);
      return c ? { status: "settled", card: c } : { status: "refused", reason: "invalid" };
    }
    if (body.status === "accepted") {
      void load(projectId);
      return { status: "accepted" };
    }
    return { status: "refused", reason: typeof body.reason === "string" ? body.reason : `http_${res.status}` };
  } catch {
    return { status: "refused", reason: "network" };
  }
}
