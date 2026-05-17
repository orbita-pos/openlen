// V3 primitive registry. The orchestrator's writer step picks primitives by
// name from this map; the editor reads it to render slot panels per variant.
//
// Server-renderable: each primitive is a pure render function (no hooks,
// no "use client") so the same registry works in renderToStaticMarkup and
// in the workspace iframe.

import { Hero } from "./Hero";
import { Stack } from "./Stack";
import { Split } from "./Split";
import { Grid } from "./Grid";
import { CTA } from "./CTA";

export const PRIMITIVE_REGISTRY = { Hero, Stack, Split, Grid, CTA } as const;
export type PrimitiveName = keyof typeof PRIMITIVE_REGISTRY;

export { Hero, Stack, Split, Grid, CTA };
export * from "./types";
