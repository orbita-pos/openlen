import type { LandingPage, ProgressEvent } from "@/lib/orchestrator/types";

export type WorkspaceState =
  | { kind: "idle" }
  | { kind: "generating"; currentStep: string; progress: ProgressEvent[] }
  | { kind: "generated"; result: LandingPage }
  | { kind: "error"; message: string };

export type StyleId = "modern" | "bold" | "warm";
export type ToneId = "professional" | "playful" | "bold" | "minimal";

export interface BriefFormState {
  prompt: string;
  setPrompt: (v: string) => void;
  audience: string;
  setAudience: (v: string) => void;
  tone: ToneId;
  setTone: (v: ToneId) => void;
  industry: string;
  setIndustry: (v: string) => void;
  sections: string[];
  setSections: (v: string[]) => void;
  style: StyleId;
  setStyle: (v: StyleId) => void;
}
