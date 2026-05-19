// Starter pack — 3 curated templates that ship in the repo so a freshly
// cloned OpenLen instance has something to render on first boot. One per
// family (technical-minimal / editorial / commerce).
//
// To seed an instance: `npm run templates:seed`. That uploads each .html
// in this folder to object storage and inserts a row in `templates`.
// After seed, add more via the admin path (CLI: `npm run templates:add`
// or the /admin/templates UI).

import type {
  TemplateFamily,
  TemplateMode,
} from "@/lib/templates/store";

export interface StarterEntry {
  id: string;
  name: string;
  family: TemplateFamily;
  accent: string;
  pitch: string;
  description: string;
  mode: TemplateMode;
  fileName: string;
}

export const STARTER_TEMPLATES: StarterEntry[] = [
  {
    id: "mirror",
    name: "Mirror",
    pitch: "Catch your AI breaking the rules before your users do.",
    family: "technical-minimal",
    accent: "#3ECF8E",
    mode: "dark",
    fileName: "mirror.html",
    description: "Runtime guardrails for LLM applications.",
  },
  {
    id: "manuscript",
    name: "Manuscript",
    pitch: "Where readers actually read.",
    family: "editorial",
    accent: "#B36A3A",
    mode: "light",
    fileName: "manuscript.html",
    description: "Newsletter platform for serious writers.",
  },
  {
    id: "counter",
    name: "Counter",
    pitch: "The POS that thinks like a barista.",
    family: "commerce",
    accent: "#C66B3D",
    mode: "cream",
    fileName: "counter.html",
    description: "Modern POS for independent coffee shops.",
  },
];
