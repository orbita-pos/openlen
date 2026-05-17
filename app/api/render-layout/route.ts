// /api/render-layout — renders one or more primitive variants to HTML for
// the workspace v2 preview iframe.
//
// Body shape (one of):
//   { primitive: "Hero" | "Stack" | ..., variant: string }            (legacy single)
//   { instances: Array<{ primitive: ..., variant: string }> }         (composition)
//
// Returns: { html: string }
//
// Uses lib/orchestrator/_render-element.ts which loads react-dom/server via
// createRequire to dodge Next.js 15's RSC graph check (the same escape hatch
// that lets the V1 orchestrator render block components on the server).

import { NextResponse } from "next/server";
import React from "react";
import { z } from "zod";
import { auth } from "@/auth";
import { renderElementToHtml } from "@/lib/orchestrator/_render-element";
import { PRIMITIVE_REGISTRY } from "@/components/primitives/_registry";
import { LAYOUT_PRESETS, getDemoSlots } from "@/lib/design/demo-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PrimitiveEnum = z.enum([
  // V3 core
  "Hero",
  "Stack",
  "Split",
  "Grid",
  "CTA",
  // V1-derived adapters (see components/primitives/v1-adapters.tsx)
  "V1HeroAnimatedGradient",
  "V1HeroLogoStrip",
  "V1PricingTwoTier",
  "V1Testimonials3Col",
  "V1FAQAccordion",
  "V1FooterFourCol",
  "V1FooterMinimal",
]);

const InstanceSchema = z.object({
  primitive: PrimitiveEnum,
  variant: z.string().min(1),
  /** Optional per-instance id; if omitted we fall back to "preview-<i>"
   *  so React keys + Slot paths stay unique across the composition. */
  id: z.string().optional(),
});

const RequestSchema = z.union([
  // Single primitive (legacy / preview-one mode)
  InstanceSchema,
  // Composition (preview-many mode)
  z.object({ instances: z.array(InstanceSchema).min(1).max(20) }),
]);

function renderInstance(
  inst: { primitive: z.infer<typeof PrimitiveEnum>; variant: string; id?: string },
  index: number,
): string {
  const preset = LAYOUT_PRESETS.find(
    (p) => p.primitive === inst.primitive && p.variant === inst.variant,
  );
  if (!preset) {
    throw new Error(`unknown layout ${inst.primitive}/${inst.variant}`);
  }
  const Component = PRIMITIVE_REGISTRY[inst.primitive] as React.ComponentType<{
    id: string;
    variant: string;
    slots: unknown;
  }>;
  const slots = getDemoSlots(inst.primitive, inst.variant);
  const element = React.createElement(Component, {
    id: inst.id ?? `preview-${index}`,
    variant: inst.variant,
    slots,
  });
  return renderElementToHtml(element);
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    if ("instances" in parsed.data) {
      const html = parsed.data.instances
        .map((inst, i) => renderInstance(inst, i))
        .join("\n");
      return NextResponse.json({ html });
    }
    // Single-primitive mode (legacy).
    const html = renderInstance(parsed.data, 0);
    return NextResponse.json({ html });
  } catch (err) {
    console.error("render-layout error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
