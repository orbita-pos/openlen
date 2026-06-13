import { listServices } from "@/lib/bookings/store";
import { json, loadBookingsSite } from "../_shared";

// GET /api/bk/[sub]/services — public: the active services a visitor can book,
// in display order. Only the fields the widget renders (never the full rules).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadBookingsSite(sub);
  if (!site || !site.bookingsEnabled) return json({ services: [] }, 200);

  const services = await listServices(site.projectId);
  return json(
    {
      requireLogin: site.requireLogin,
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        durationMin: s.durationMin,
        priceDisplay: s.priceDisplay, // informational text only
        locationText: s.locationText,
        creatorTz: s.creatorTz,
      })),
    },
    200,
  );
}
