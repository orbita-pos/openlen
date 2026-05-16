import type {
  FilledBlock,
  GeneratedImage,
  Intent,
  LandingPage,
  Plan,
  ProgressEvent,
} from "@/lib/orchestrator/types";

export interface RegenInFlight {
  sectionId: string;
  sectionName: string;
  mode: "regen" | "edit";
}

export interface GeneratingPartial {
  brief: string;
  intent?: Intent;
  plan?: Plan;
  filledBlocks: FilledBlock[];
  images: GeneratedImage[];
  costSoFar: number;
  startedAt: number;
}

export type WorkspaceState =
  | { kind: "idle" }
  | {
      kind: "generating";
      currentStep: string;
      progress: ProgressEvent[];
      partial: GeneratingPartial;
    }
  | {
      kind: "generated";
      result: LandingPage;
      regen?: RegenInFlight;
      /** Project id when the page has been persisted server-side. */
      projectId?: string;
      /** Display title — populated from the project_saved event. */
      title?: string;
    }
  | { kind: "error"; message: string };

export interface BriefFormState {
  prompt: string;
  setPrompt: (v: string) => void;
}
