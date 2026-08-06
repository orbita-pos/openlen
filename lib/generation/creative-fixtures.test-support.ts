export const COLORING_INTENT = {
  schemaVersion: "intent-analysis/1.0",
  language: "en",
  functional: { siteType: "coloring_pages", requiredSections: ["hero"], primaryActions: ["download"], contentModel: "printables" },
  audience: { primary: "parents", ageRange: "children", secondary: ["teachers"] },
  domains: ["education"], emotionalGoals: ["playful"], requiredVisualSignals: ["friendly"], forbiddenVisualSignals: ["corporate"], explicitConstraints: [], ambiguities: [], confidence: 0.9,
} as const;

export const COLORING_DIRECTION = {
  schemaVersion: "creative-direction/1.0",
  mode: "cream",
  visualArchetype: "illustrated_creative_play",
  emotionalTone: ["playful", "friendly"],
  palette: { background: "#FFF8E8", surface: "#FFFFFF", surfaceAlt: "#F5E6C8", foreground: "#302A24", foregroundMuted: "#786E63", accent: "#EA7F3D", accentInk: "#FFFFFF", border: "#E4D3B7" },
  typography: { display: "rounded_playful", body: "friendly_high_legibility", mono: null, scale: "balanced" },
  geometry: { radius: "soft", radiusScale: 1, spacingScale: 1, density: "low_medium" },
  imagery: { strategy: "illustration_first", artDirection: "hand_drawn", subjects: ["animals", "rainbows"], avoid: ["photorealism"] },
  iconography: { style: "rounded_outline", strokeWeight: "medium", cornerStyle: "round" },
  componentTreatment: { cards: "soft_bordered", buttons: "rounded_filled", navigation: "simple", sections: "airy" },
  requiredVisualSignals: ["playful", "friendly"],
  forbiddenVisualSignals: ["corporate"],
} as const;

export const COLORING_PLAN = {
  schemaVersion: "skeleton-adaptation-plan/1.0",
  tokens: { "--ol-bg": "#FFF8E8", "--ol-surface": "#FFFFFF", "--ol-fg": "#302A24", "--ol-accent": "#EA7F3D" },
  cssOverride: [{ hookId: "hero", declarations: { "background-color": "#FFF8E8", color: "#302A24" } }],
  assets: [{ slotIndex: 0, action: "replace", mediaType: "illustration", query: "playful coloring page animals", alt: "Friendly animals ready to color", required: true }],
} as const;

export const COLORING_TEMPLATE_METADATA = {
  templateId: "coloring-template",
  availableTokens: ["--ol-bg", "--ol-surface", "--ol-fg", "--ol-accent"],
  styleHooks: [{ id: "hero", selector: ".hero", allowedProperties: ["background-color", "color"] }],
  assetSlots: [{ slotIndex: 0, kind: "image", role: "hero", currentAlt: "Abstract image", replaceable: true }],
  structuralFingerprint: "coloring-v1",
} as const;

export const SKELETON_HTML = '<main><section class="hero"><img src="/placeholder.png" alt="Abstract image"></section></main>';
export const NORMALIZED_SKELETON_HTML = '<main><section class="hero"><img alt="Abstract image"></section></main>';
export const FIXTURE_IMAGES = [{ slotIndex: 0, src: "/fixtures/coloring-animals.png", alt: "Friendly animals ready to color" }] as const;
