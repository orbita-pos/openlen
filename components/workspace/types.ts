// Shared state shape for the brief-input form — the AI entry panel
// (components/workspace-v2/panels/ai-brief-panel.tsx) and the left-sidebar
// wiring both consume it.
export interface BriefFormState {
  prompt: string;
  setPrompt: (v: string) => void;
}
