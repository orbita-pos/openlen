import "@inariwatch/capture/auto";
import {
  VisualMetadataReviewLauncherError,
  runVisualMetadataReviewer,
} from "../../lib/templates/visual-metadata-review-launcher";

async function main(): Promise<void> {
  await runVisualMetadataReviewer();
}

main().catch((error: unknown) => {
  const category = error instanceof VisualMetadataReviewLauncherError
    ? error.code
    : "REVIEWER_LAUNCH_FAILED";
  console.error(`error=${category}`);
  process.exitCode = 1;
});
