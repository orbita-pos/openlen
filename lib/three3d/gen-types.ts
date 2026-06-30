import type { SceneSpec, Look, MaterialKind } from "./scene-spec";

export type Provider = "gemini" | "mock";

export interface GenInput {
  describe: string;
  look?: Look;
  brandMatch?: boolean;          // default true
  behavior?: "float-rotate" | "still";
  accent?: string;               // page accent hex, applied when brandMatch !== false
  register?: MaterialKind;       // material.kind override; transmissive kinds force gradient backdrop
  devSpec?: unknown;             // mock injected-spec channel (ignored unless provider resolves to "mock")
}

export interface GenResult {
  spec: SceneSpec;
  provider: Provider;
  rerolls: number;
  fallback: boolean;
}
