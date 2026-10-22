// /email/v1/* — project email (spec local docs/superpowers/specs/2026-10-22-email-integration-design.md):
// Resend's API, called by a project's Edge Functions with its secret key. The
// project comes from the host; the whole logic lives in lib/project-email/serve.ts.

import { serveProjectEmail } from "@/lib/project-email/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = serveProjectEmail;
export const POST = serveProjectEmail;
