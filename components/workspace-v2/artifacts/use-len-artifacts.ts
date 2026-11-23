"use client";

// LEN'S ARTIFACTS IN A PROJECT (spec local 2026-11-22-artifacts-de-len, §4): loads the project's artifacts made by Len
// (`GET /api/len-artifacts?projectId=`), handles the `artifact:<id>` lens value, and opens the newest artifact's lens
// when `publish_artifact` finishes `done` in the live turn (as Claude Code opens an artifact it just published).
// A member gets a 404 from the route -> empty list -> nothing drawn.
import { useCallback, useEffect, useRef, useState } from "react";

import type { LenArtifactListItem } from "./artifact-pane";

export type ArtifactLens = `artifact:${string}`;

export function artifactLens(id: string): ArtifactLens {
  return `artifact:${id}`;
}

export function artifactIdOfLens(lens: string): string | null {
  return lens.startsWith("artifact:") ? lens.slice("artifact:".length) : null;
}

function updatedMs(item: LenArtifactListItem): number {
  if (!item.updatedAt) return -1;
  const ms = Date.parse(item.updatedAt);
  return Number.isNaN(ms) ? -1 : ms;
}

/** Picks which artifact was just published (or republished): prefers an artifact that is new or whose version/timestamp
 *  moved since `prev`, breaking ties by latest `updatedAt` and then creation order (last in list). */
export function newestArtifactId(
  items: readonly LenArtifactListItem[],
  prev?: readonly LenArtifactListItem[],
): string | null {
  if (items.length === 0) return null;
  let pool: readonly LenArtifactListItem[] = items;
  if (prev && prev.length > 0) {
    const prevById = new Map(prev.map((x) => [x.id, x]));
    const changed = items.filter((item) => {
      const before = prevById.get(item.id);
      return !before || before.releaseSha !== item.releaseSha || before.updatedAt !== item.updatedAt;
    });
    if (changed.length > 0) pool = changed;
  }
  let best = pool[0]!;
  let bestMs = updatedMs(best);
  for (let i = 1; i < pool.length; i++) {
    const candidate = pool[i]!;
    const ms = updatedMs(candidate);
    if (ms >= bestMs) {
      best = candidate;
      bestMs = ms;
    }
  }
  return best.id;
}

export interface LenArtifactsState {
  readonly items: LenArtifactListItem[];
  readonly loaded: boolean;
  readonly reload: () => Promise<LenArtifactListItem[] | null>;
  readonly remove: (id: string) => void;
  readonly version: number;
}

export function useLenArtifacts(projectId: string | null): LenArtifactsState {
  const [items, setItems] = useState<LenArtifactListItem[]>([]);
  const [loaded, setLoaded] = useState<boolean>(projectId === null);
  const [version, setVersion] = useState(0);
  const reqRef = useRef(0);

  const reload = useCallback(async (): Promise<LenArtifactListItem[] | null> => {
    if (!projectId) {
      reqRef.current += 1;
      setItems([]);
      setLoaded(true);
      return [];
    }
    const reqId = ++reqRef.current;
    try {
      const res = await fetch(`/api/len-artifacts?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (reqId !== reqRef.current) return null;
      if (!res.ok) {
        setItems([]);
        setLoaded(true);
        setVersion((v) => v + 1);
        return [];
      }
      const data: unknown = await res.json();
      if (reqId !== reqRef.current) return null;
      const list = Array.isArray(data) ? (data as LenArtifactListItem[]) : [];
      setItems(list);
      setLoaded(true);
      setVersion((v) => v + 1);
      return list;
    } catch {
      // fail-soft: the workspace stays usable without the artifact lenses
      if (reqId === reqRef.current) setLoaded(true);
      return null;
    }
  }, [projectId]);

  useEffect(() => {
    setItems([]);
    if (!projectId) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    void reload();
  }, [projectId, reload]);

  const remove = useCallback((id: string) => {
    reqRef.current += 1;
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return { items, loaded, reload, remove, version };
}

export interface ArtifactTurnLike {
  readonly id: string;
  readonly status: string;
  readonly actions: readonly { readonly tool: string; readonly status: string }[];
}

/** Watches the workspace's `latestTurn`: reloads the project's artifacts when `publish_artifact` finishes `done` (and
 *  opens the newest artifact's lens) or when a streaming turn settles. Never steals focus on initial mount or after a
 *  failed reload. */
export function useArtifactTurnSync({
  projectId,
  latestTurn,
  artifacts,
  onOpenArtifact,
}: {
  projectId: string | null;
  latestTurn: ArtifactTurnLike | null;
  artifacts: LenArtifactsState;
  onOpenArtifact: (lens: ArtifactLens) => void;
}): void {
  const mountedProjectRef = useRef<string | null>(null);
  const prevTurnRef = useRef<{ id: string; status: string; published: number } | null>(null);
  const openGenRef = useRef(0);
  const itemsRef = useRef(artifacts.items);
  itemsRef.current = artifacts.items;
  const onOpenRef = useRef(onOpenArtifact);
  onOpenRef.current = onOpenArtifact;

  useEffect(() => {
    mountedProjectRef.current = null;
    prevTurnRef.current = null;
    openGenRef.current += 1;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      mountedProjectRef.current = null;
      prevTurnRef.current = null;
      return;
    }
    const published = latestTurn ? latestTurn.actions.filter((a) => a.tool === "publish_artifact" && a.status === "done").length : 0;
    // First observation for this project: record baseline (null or historical turn) so reload never steals focus.
    if (mountedProjectRef.current !== projectId) {
      mountedProjectRef.current = projectId;
      prevTurnRef.current = latestTurn ? { id: latestTurn.id, status: latestTurn.status, published } : null;
      return;
    }
    if (!latestTurn) {
      prevTurnRef.current = null;
      return;
    }
    const prev = prevTurnRef.current;
    prevTurnRef.current = { id: latestTurn.id, status: latestTurn.status, published };
    const sameTurn = prev !== null && prev.id === latestTurn.id;
    const justPublished =
      (sameTurn && published > prev.published) || (!sameTurn && latestTurn.status === "streaming" && published > 0);
    const justSettled = sameTurn && prev.status === "streaming" && latestTurn.status !== "streaming";
    if (justPublished) {
      const prevItems = itemsRef.current;
      const gen = ++openGenRef.current;
      void artifacts.reload().then((next) => {
        if (!next || openGenRef.current !== gen) return;
        const newest = newestArtifactId(next, prevItems);
        if (newest) onOpenRef.current(artifactLens(newest));
      });
    } else if (justSettled) {
      void artifacts.reload();
    }
  }, [projectId, latestTurn, artifacts.reload]);
}
