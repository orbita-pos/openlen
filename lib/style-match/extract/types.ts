// Intermediate token shapes — what each extract/*.ts emits.
// merge-tokens.ts assembles these into the DTCG v2025.10 output.

export interface ColorEntry {
  hex: string;
  oklch: { l: number; c: number; h: number };
  weight: number;
  occurrenceCount: number;
}

export interface ColorTokens {
  primary?: ColorEntry;
  accents: ColorEntry[];
  neutrals: { step: string; entry: ColorEntry }[];
  semantic?: {
    success?: ColorEntry;
    warning?: ColorEntry;
    danger?: ColorEntry;
  };
  polarity: "light" | "dark";
  raw: ColorEntry[];
}

export interface TypographyTokens {
  family: {
    primary: string;
    display?: string;
    mono?: string;
  };
  declaredFamilies: { stack: string; usage: number }[];
  size: {
    detected: number[];
    scale: Record<string, number>;
    ratio: number | null;
    ratioMatch:
      | "minor-second"
      | "major-second"
      | "minor-third"
      | "major-third"
      | "perfect-fourth"
      | "augmented-fourth"
      | "perfect-fifth"
      | "golden-ratio"
      | "custom";
  };
  weights: { value: number; label: string }[];
}

export interface SpacingTokens {
  base: 4 | 6 | 8;
  scale: Record<string, number>;
  detectedValues: number[];
}

export interface RadiusTokens {
  personality: "sharp" | "soft" | "rounded" | "pill";
  scale: Record<string, number>;
  distinctValues: number[];
}

export interface ShadowEntry {
  raw: string;
  layerCount: number;
  maxBlur: number;
  hasColored: boolean;
}

export interface ShadowTokens {
  personality: "none" | "soft" | "layered" | "dramatic" | "colored";
  distinct: ShadowEntry[];
}

export interface ExtractedTokens {
  source: {
    url: string;
    hostname: string;
    finalUrl: string;
    extractedAt: string;
  };
  color: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radius: RadiusTokens;
  shadow: ShadowTokens;
}
