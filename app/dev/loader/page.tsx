import { notFound } from "next/navigation";
import { PageBuildingLoader } from "@/components/workspace-v2/page-building-loader";

// Dev-only preview of the page-building loader. Open /dev/loader to see and
// iterate the animation without triggering a real (credit-spending)
// generation. 404s in production so it never ships as a public route.
export default function LoaderPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <PageBuildingLoader caption="Designing your page…" />
    </div>
  );
}
