// /api/render-layout — renders a single primitive variant to HTML for the
// workspace v2 layout picker.
//
// Body: { primitive: "Hero" | "Stack" | "Split" | "Grid" | "CTA", variant: string }
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

const RequestSchema = z.object({
  primitive: z.enum(["Hero", "Stack", "Split", "Grid", "CTA"]),
  variant: z.string().min(1),
});

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
  const { primitive, variant } = parsed.data;

  // Validate the (primitive, variant) pair exists in the registry.
  const preset = LAYOUT_PRESETS.find(
    (p) => p.primitive === primitive && p.variant === variant,
  );
  if (!preset) {
    return NextResponse.json({ error: `unknown layout ${primitive}/${variant}` }, { status: 400 });
  }

  try {
    const Component = PRIMITIVE_REGISTRY[primitive] as React.ComponentType<{
      id: string;
      variant: string;
      slots: unknown;
    }>;
    const slots = getDemoSlots(primitive, variant);
    const element = React.createElement(Component, {
      id: "preview",
      variant,
      slots,
    });
    const html = renderElementToHtml(element);
    return NextResponse.json({ html });
  } catch (err) {
    console.error("render-layout error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
