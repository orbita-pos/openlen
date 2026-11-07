"use client";

// THE PERSON'S ASSISTANTS IN THE START RAIL (spec local 2026-11-06-asistente-propio, §6.3): each one, with its figure,
// leads to its place. Asked once; without a session (the home, signed out) or without any, nothing is drawn.
import { useEffect, useState } from "react";

import { Link } from "@/i18n/navigation";
import type { AssistantView } from "@/lib/assistants/view";
import { cn } from "@/lib/cn";

import { Tooltip } from "../ui";
import { AssistantFigure } from "./figure";

export function AssistantRailLinks({ open, onDone }: { open: boolean; onDone?: () => void }) {
  const [mine, setMine] = useState<readonly AssistantView[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/assistants")
      .then((r) => (r.ok ? (r.json() as Promise<{ assistants?: AssistantView[] }>) : { assistants: [] }))
      .then((b) => live && setMine(b.assistants ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (mine.length === 0) return null;
  return (
    <div className={cn("mt-2 flex flex-col gap-1 border-t bd pt-2", !open && "items-center")}>
      {mine.map((a) => {
        const link = (
          <Link
            key={a.id}
            href={`/assistant/${a.slug}`}
            data-assistant-rail-link=""
            onClick={onDone}
            className={cn("flex items-center rounded-lg fg-muted transition hover:bg-hover hover:fg", open ? "h-9 w-full gap-3 px-2.5 text-[13.5px] font-medium" : "h-9 w-9 justify-center")}
          >
            <AssistantFigure shape={a.shape} color={a.color} size={20} />
            {open ? <span className="truncate">{a.name}</span> : null}
          </Link>
        );
        return open ? (
          link
        ) : (
          <Tooltip key={a.id} label={a.name} side="right">
            {link}
          </Tooltip>
        );
      })}
    </div>
  );
}
