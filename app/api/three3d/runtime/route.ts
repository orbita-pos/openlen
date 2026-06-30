import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  try {
    const js = readFileSync(
      join(process.cwd(), "lib/three3d/runtime/dist/openlen-3d.js"),
      "utf8",
    );
    return new NextResponse(js, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
