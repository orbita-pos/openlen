// /storage/v1/* — el Storage de las páginas, con la API de Supabase Storage
// (lib/backend/storage, plans/len-agente-2026/plan-2-5/d-storage.md). Sólo
// contesta en el host del `ref`; la lógica entera vive en lib/backend/serve.ts.

import { serveBackend } from "@/lib/backend/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = serveBackend;
export const HEAD = serveBackend;
export const POST = serveBackend;
export const PUT = serveBackend;
export const PATCH = serveBackend;
export const DELETE = serveBackend;
export const OPTIONS = serveBackend;
