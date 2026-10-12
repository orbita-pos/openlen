// /functions/v1/* — las Edge Functions de las páginas y las apps, con la API de
// Supabase (spec local docs/superpowers/specs/2026-10-11-edge-functions-design.md).
// El proyecto sale del host; la lógica entera vive en lib/functions/serve.ts.

import { serveFunctions } from "@/lib/functions/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = serveFunctions;
export const HEAD = serveFunctions;
export const POST = serveFunctions;
export const PUT = serveFunctions;
export const PATCH = serveFunctions;
export const DELETE = serveFunctions;
export const OPTIONS = serveFunctions;
