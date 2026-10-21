"use client";

import {createContext,useContext} from "react";
import type {ArtifactSummary} from "./client";

/**
 * The project's deliverables, read once by `/new` and shared with what shows them: the bell, the center and
 * the chat's cards. `open` shows a piece where it belongs — in the center when the project has no page, in the
 * viewer otherwise. Absent (null) where deliverables are off: everything that reads it then shows nothing.
 */
export interface WorkspaceArtifacts {
  readonly items: readonly ArtifactSummary[];
  open(item: ArtifactSummary): void;
}

export const WorkspaceArtifactsContext = createContext<WorkspaceArtifacts | null>(null);

export function useWorkspaceArtifacts(): WorkspaceArtifacts | null {
  return useContext(WorkspaceArtifactsContext);
}
