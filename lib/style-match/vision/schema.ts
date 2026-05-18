import { z } from "zod";

const HEX = /^#([0-9a-fA-F]{3,8})$/;

export const VisionAnalysisSchema = z.object({
  design_language: z.enum([
    "modern",
    "warm",
    "brutal",
    "editorial",
    "technical",
    "playful",
  ]),
  design_language_confidence: z.number().min(0).max(1),
  visual_hierarchy_clarity: z.number().int().min(1).max(5),
  whitespace_use: z.enum(["tight", "balanced", "generous"]),
  motion_implied: z.enum(["still", "subtle", "dynamic"]),
  color_roles: z.object({
    background: z.string().regex(HEX),
    foreground_primary: z.string().regex(HEX),
    accent: z.string().regex(HEX),
    muted: z.string().regex(HEX),
    border: z.string().regex(HEX),
  }),
  top_3_design_choices_that_define_this_page: z.array(z.string().max(120)).length(3),
  type_personality: z.enum([
    "geometric",
    "humanist",
    "neogrotesque",
    "serif_editorial",
    "display_decorative",
  ]),
  shadow_intensity: z.enum(["none", "subtle", "dramatic"]),
  radius_personality: z.enum(["sharp", "soft", "pill"]),
  vibe_summary: z.string().max(180),
});

export type VisionAnalysis = z.infer<typeof VisionAnalysisSchema>;
