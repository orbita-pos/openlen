import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageBuildingLoader } from "@/components/workspace-v2/page-building-loader";

// Dev-only preview of the page-building loader. Open /dev/loader to see and
// iterate the animation without triggering a real (credit-spending)
// generation. 404s in production so it never ships as a public route.
export default async function LoaderPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("pages");
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <PageBuildingLoader caption={t("devLoader.caption")} />
    </div>
  );
}
