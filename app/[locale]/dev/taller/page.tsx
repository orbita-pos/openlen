import { notFound } from "next/navigation";

import { WorkshopPreview } from "./view";

// Dev-only: the app-birth workshop (components/workspace-v2/app-birth-workshop.tsx)
// going through Len's stations with real tool cards, to see and iterate it
// without paying for a turn. `?tema=oscuro` paints it dark; `?paso=N` stops at
// step N of the demo. 404 in production, like /dev/loader.
export default async function WorkshopPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string; paso?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tema, paso } = await searchParams;
  const step = paso !== undefined && /^\d+$/.test(paso) ? Number(paso) : null;
  return <WorkshopPreview dark={tema === "oscuro"} step={step} />;
}
