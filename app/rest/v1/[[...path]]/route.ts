// /rest/v1/* — el backend de las páginas, con la API de Supabase
// (lib/backend, plans/pages-backend/design.md). El proyecto sale del host; la
// lógica entera vive en lib/backend/serve.ts.

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
