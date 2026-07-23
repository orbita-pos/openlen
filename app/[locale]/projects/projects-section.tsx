"use client";

// Workspace-only wrapper: the /projects route fetches its data server-side; here
// we fetch it client-side (GET /api/projects) and render the SAME ProjectsView
// in the editor center. JSON turns the date fields into strings — revive them,
// since ProjectsView calls .getTime() on createdAt/updatedAt.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProjectSummary } from "@/lib/projects";
import { ALL_BUSINESSES } from "@/components/workspace-v2/business-switcher";
import { ProjectsView, type BusinessOption } from "./projects-view";

export function ProjectsSection({
  activeBusinessId,
  onOpenExplore,
}: {
  activeBusinessId?: string;
  onOpenExplore?: () => void;
}) {
  const [state, setState] = useState<{
    projects: ProjectSummary[];
    profiles: BusinessOption[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { projects?: unknown[]; profiles?: BusinessOption[] } | null) => {
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
        setState({ projects, profiles: d.profiles ?? [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Scope to the active business (the rail switcher). "all"/none → everything.
  const visibleProjects = useMemo(() => {
    if (!state) return [];
    if (!activeBusinessId || activeBusinessId === ALL_BUSINESSES)
      return state.projects;
    return state.projects.filter((p) => p.profileId === activeBusinessId);
  }, [state, activeBusinessId]);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto flex flex-col bg-app">
      {state ? (
        <ProjectsView
          projects={visibleProjects}
          profiles={state.profiles}
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
