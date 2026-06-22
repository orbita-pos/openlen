import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSubdomainOwner } from "@/lib/projects";
import { recordSubmission } from "@/lib/projects/forms";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { sendLeadNotificationEmail } from "@/lib/email";
import { normalizeCountry, parseUserAgent } from "@/lib/analytics/parse";
import { parseCid } from "@/lib/analytics/cid";

// ─────────────────────────────────────────────────────────────────────────────
// Public form-submission endpoint. A <form> on a published page (wired by
// lib/publish/forms.ts) POSTs here. No auth — visitors submit. Honeypot +
// per-IP rate-limit guard against spam. A fetch caller (the inline-submit
// script) gets JSON + CORS; a native no-JS form POST gets a 303 back to the
// page with ?openlen_form=ok.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const MAX_FIELDS = 40;
const MAX_FIELD_LEN = 5000;
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com";

function publishedBase(sub: string): string {
  const host = process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
  return `https://${sub}.${host}`;
}

// Same slug shape lib/projects/site-pages.ts accepts.
const PAGE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const wantsJson = (req.headers.get("accept") ?? "").includes(
    "application/json",
  );
  // Multi-page: the publish wiring appends ?page=<slug> to the form action so
  // we know which document the form lives on — drives page-scoped config,
  // lead attribution, and the no-JS redirect target.
  const pageParam = new URL(req.url).searchParams.get("page") ?? "";
  const page = PAGE_SLUG_RE.test(pageParam) ? pageParam : null;

  const owner = await getSubdomainOwner(sub);
  if (!owner) return done(wantsJson, sub, false, 404, page);

  // Per-IP rate-limit — anti-spam on a public endpoint.
  const ip = getClientIp(req);
  const limit = await checkAndConsume(ipLimitKey(ip, "form-submit"), [
    { windowMs: HOUR, max: 20, label: "hourly" },
  ]);
  if (!limit.ok) return done(wantsJson, sub, false, 429, page);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return done(wantsJson, sub, false, 400, page);
  }

  // Honeypot — bots fill the hidden field; humans never see it. Pretend
  // success so the bot doesn't learn it was caught, but store nothing.
  const hp = form.get("_openlen_hp");
  if (typeof hp === "string" && hp.trim().length > 0) {
    return done(wantsJson, sub, true, 200, page);
  }

  const data: Record<string, string> = {};
  let count = 0;
  let formIndex: number | null = null;
  let cid: string | undefined;
  for (const [key, value] of form.entries()) {
    if (key === "_openlen_hp") continue;
    if (key === "_openlen_form") {
      // Which <form> on the page submitted — maps to its per-form config.
      if (typeof value === "string") {
        const n = Number.parseInt(value, 10);
        if (Number.isInteger(n) && n >= 0) formIndex = n;
      }
      continue;
    }
    if (key === "_openlen_cid") {
      // Session visitor id (JS-stamped hidden input) — links this lead to its
      // view for funnel attribution. Validated; absent on a native no-JS POST.
      cid = parseCid(value) ?? undefined;
      continue;
    }
    if (typeof value !== "string") continue; // v1: no file uploads
    if (count >= MAX_FIELDS) break;
    data[key.slice(0, 200)] = value.slice(0, MAX_FIELD_LEN);
    count += 1;
  }
  if (count === 0) return done(wantsJson, sub, false, 400, page);

  // Capture submission-time signals for the email + analytics. Country
  // comes from Cloudflare's CF-IPCountry; device + browser are derived
  // from UA via the same parser the analytics collector uses.
  const ua = req.headers.get("user-agent")?.slice(0, 500) ?? undefined;
  const country = normalizeCountry(req.headers.get("cf-ipcountry"));
  const { device, browser } = parseUserAgent(ua ?? "");
  const referer = req.headers.get("referer")?.slice(0, 500) ?? undefined;
  const submittedAt = new Date();

  try {
    await recordSubmission({
      projectId: owner.projectId,
      data,
      meta: {
        ip,
        ua,
        ref: referer,
        country,
        device,
        browser,
        // Which document the form lives on (null = home) — the Leads views
        // surface it so multi-page sites can triage by source page.
        page,
        cid,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[forms] record failed", err);
    return done(wantsJson, sub, false, 500, page);
  }

  // Fire-and-forget — notifying the owner must never delay the visitor.
  void notifyOwner(owner.projectId, data, formIndex, page, {
    submittedAt,
    country,
    device,
    browser,
    referer: referer ?? null,
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[forms] notifyOwner failed", err);
  });

  return done(wantsJson, sub, true, 200, page);
}

interface NotifyMeta {
  submittedAt: Date;
  country: string | null;
  device: string | null;
  browser: string | null;
  referer: string | null;
}

async function notifyOwner(
  projectId: string,
  data: Record<string, string>,
  formIndex: number | null,
  page: string | null,
  meta: NotifyMeta,
): Promise<void> {
  const rows = await db
    .select({
      email: schema.users.email,
      title: schema.projects.title,
      projectData: schema.projects.data,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.projects.userId, schema.users.id))
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  // The per-form notify override (Phase 2) wins over the account email;
  // fall back to the account email when it's unset. Site-page forms resolve
  // their scoped key ("<slug>:<index>") first, then the legacy shared index.
  let to = row.email ?? "";
  if (formIndex !== null) {
    const forms = row.projectData?.settings?.forms;
    const override =
      (page ? forms?.[`${page}:${formIndex}`]?.notifyEmail : undefined) ??
      forms?.[String(formIndex)]?.notifyEmail;
    if (override) to = override;
  }
  if (!to) {
    // Surface the silent-drop in the journal so an OAuth user with no
    // notify override AND no account email knows leads aren't going
    // anywhere. The submission is still in the DB.
    // eslint-disable-next-line no-console
    console.warn(
      `[forms] no destination email for project ${projectId} (formIndex ${formIndex}); submission stored but no notification sent`,
    );
    return;
  }
  await sendLeadNotificationEmail({
    to,
    projectTitle: row.title,
    fields: data,
    dashboardUrl: `${SITE_URL}/new?project=${projectId}`,
    meta,
  });
}

function done(
  wantsJson: boolean,
  sub: string,
  ok: boolean,
  errStatus: number,
  page: string | null,
): Response {
  if (wantsJson) {
    return new Response(JSON.stringify({ ok }), {
      status: ok ? 200 : errStatus,
      headers: {
        "content-type": "application/json",
        // The form lives on <sub>.openlen.com — a different origin than this
        // endpoint — so the inline-submit fetch needs CORS to read the result.
        "access-control-allow-origin": "*",
      },
    });
  }
  // Native (no-JS) form POST — redirect the visitor back to the page the
  // form actually lives on (home, or /<slug>/ for a site page).
  const path = page ? `/${page}/` : "/";
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${publishedBase(sub)}${path}?openlen_form=${ok ? "ok" : "err"}`,
    },
  });
}
