// The «@» index of the open project (spec local 2026-10-27, §6.2), kept warm so
// typing «@» never waits for the network: fetched once, then revalidated with
// its ETag when the box gets focus or a turn ends (`refresh`). A page site's
// pages are parsed here, by the browser's parser — the canvas's.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildPageEntries } from "@/lib/mentions/page-entries";
import type { MentionEntry, MentionIndexResponse } from "@/lib/mentions/types";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

function entriesOf(body: MentionIndexResponse): MentionEntry[] {
  if (body.kind === "app") return body.entries;
  return body.pages.flatMap((p) => buildPageEntries(p.tagged, p.page, p.ruta, parse));
}

export function useMentionIndex(projectId: string | null): {
  entries: MentionEntry[];
  files: string[];
  ready: boolean;
  refresh: () => void;
} {
  const [state, setState] = useState<{ entries: MentionEntry[]; files: string[]; ready: boolean }>({ entries: [], files: [], ready: false });
  const etag = useRef<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (!projectId || inFlight.current) return;
    inFlight.current = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/mention-index`, {
      cache: "no-store",
      headers: etag.current ? { "if-none-match": etag.current } : {},
    })
      .then(async (res) => {
        if (res.status === 304 || !res.ok) return;
        const body = (await res.json()) as MentionIndexResponse;
        etag.current = res.headers.get("etag");
        setState({ entries: entriesOf(body), files: body.files, ready: true });
      })
      .catch(() => {
        // Offline or the server said no: the «@» keeps what it had.
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [projectId]);

  useEffect(() => {
    etag.current = null;
    setState({ entries: [], files: [], ready: false });
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
