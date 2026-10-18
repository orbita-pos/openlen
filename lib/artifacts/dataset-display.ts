import type {ArtifactDataset} from "./types";
/** Frozen display data is portable; the saved query and query parameters stay
 * in permission-checked server sources, not in previews or downloaded HTML. */
export function artifactDatasetForDisplay(dataset:ArtifactDataset){
  const {id,mode,environment,columns,rows,source,capturedAt,truncated}=dataset;
  return {id,mode,environment,columns,rows,source,capturedAt,truncated};
}
