import type {
  Copy,
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
  copy?: Copy;
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
  | { kind: "generated"; result: LandingPage; regen?: RegenInFlight }
  | { kind: "error"; message: string };

export interface BriefFormState {
  prompt: string;
  setPrompt: (v: string) => void;
}
