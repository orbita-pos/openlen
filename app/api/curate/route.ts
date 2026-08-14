import { createCuratePost } from "@/lib/curate/curate-post-handler";

export const runtime = "nodejs";
export const maxDuration = 900;

export const POST = createCuratePost();
