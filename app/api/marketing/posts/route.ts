import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listPostTemplates } from "@/lib/marketing/post-templates/store";
import { POST_GOAL, POST_REGISTER } from "@/lib/marketing/post-templates/admin-schemas";

// GET /api/marketing/posts?register=<slug>&goal=<slug> — the published
// post-template catalog for the workspace's Marketing tab grid. Server-filtered
// by register and/or goal (both optional); listPostTemplates already folds in
// the "general" fallback designs alongside a specific register.
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });

  const rawRegister = req.nextUrl.searchParams.get("register");
  let register: ReturnType<typeof POST_REGISTER.parse> | undefined;
  if (rawRegister) {
    const parsed = POST_REGISTER.safeParse(rawRegister);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_register" }, { status: 400 });
    }
    register = parsed.data;
  }

  const rawGoal = req.nextUrl.searchParams.get("goal");
  let goal: ReturnType<typeof POST_GOAL.parse> | undefined;
  if (rawGoal) {
    const parsed = POST_GOAL.safeParse(rawGoal);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_goal" }, { status: 400 });
    }
    goal = parsed.data;
  }

  const posts = await listPostTemplates({ register, goal });
  return NextResponse.json({ posts });
}
