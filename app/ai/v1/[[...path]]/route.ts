// /ai/v1/* — the AI of the apps (spec local
// docs/superpowers/specs/2026-10-15-app-ai-design.md): OpenAI's chat format,
// called by a project's Edge Functions with its secret key. The project comes
// from the host; the whole logic lives in lib/app-ai/serve.ts.

import { serveAppAi } from "@/lib/app-ai/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = serveAppAi;
export const POST = serveAppAi;
