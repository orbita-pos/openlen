"use client";

// Workspace-only wrapper: the /projects route fetches its data server-side; here
// we fetch it client-side (GET /api/projects) and render the SAME ProjectsView
// in the editor center. JSON turns the date fields into strings — revive them,
// since ProjectsView calls .getTime() on createdAt/updatedAt.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProjectSummary } from "@/lib/projects";
import { ProjectsView } from "./projects-view";

export function ProjectsSection({
  onOpenExplore,
}: {
  onOpenExplore?: () => void;
}) {
  const [state, setState] = useState<{
    projects: ProjectSummary[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { projects?: unknown[] } | null) => {
        if (cancelled || !d) return;
        const projects = (d.projects ?? []).map((raw) => {
          const p = raw as ProjectSummary & {
            createdAt: string;
            updatedAt: string;
            publishedAt: string | null;
          };
          return {
            ...p,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
            publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
          } as ProjectSummary;
        });
        setState({ projects });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto flex flex-col bg-app">
      {state ? (
        <ProjectsView
          projects={state.projects}
          onOpenExplore={onOpenExplore}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      )}
    </div>
  );
}
