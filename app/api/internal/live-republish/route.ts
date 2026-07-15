import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { liveDataEnabled } from "@/lib/publish/kill-switches";
import { runLiveRepublish } from "@/lib/live/republish";
import { liveRepublishDeps } from "@/lib/live/deps";

// Disparado por infra/app/openlen-live-republish.timer (curl localhost desde
// systemd), NO expuesto públicamente. Corre EN PROCESO con la app —a
// diferencia de scripts/live-republish.ts, que va vía tsx/bundle— porque el
// server ya tiene los crates nativos (.node) cargados; esquiva el problema de
// bundling que scripts/build-cron.mjs documenta (esbuild no puede empaquetar
// esos crates en un .mjs standalone).
export const dynamic = "force-dynamic";
export const maxDuration = 300; // barrido de N páginas; volumen v1 minúsculo

function ok(req: Request): boolean {
  const secret = process.env.OPENLEN_INTERNAL_SECRET;
  if (!secret) return false; // fail-closed: sin secreto en el entorno, SIEMPRE 401
  const given = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!ok(req)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!liveDataEnabled()) return NextResponse.json({ ok: false, reason: "disabled" }, { status: 503 });
  const summary = await runLiveRepublish(liveRepublishDeps());
  return NextResponse.json({ ok: true, summary });
}
