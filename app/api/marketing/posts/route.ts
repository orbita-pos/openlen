import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listPostTemplates } from "@/lib/marketing/post-templates/store";
import { POST_REGISTER } from "@/lib/marketing/post-templates/admin-schemas";

// GET /api/marketing/posts?register=<slug> — the published post-template
// catalog for the workspace's Marketing tab grid. Server-filtered by register
// (absent → the full published catalog); listPostTemplates already folds in
// the "general" fallback designs alongside a specific register.
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });

  const raw = req.nextUrl.searchParams.get("register");
  let register: ReturnType<typeof POST_REGISTER.parse> | undefined;
  if (raw) {
    const parsed = POST_REGISTER.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_register" }, { status: 400 });
    }
    register = parsed.data;
  }

  const posts = await listPostTemplates({ register });
  return NextResponse.json({ posts });
}
