import {notFound} from "next/navigation";
import {ArtifactsPreview} from "./view";

export default function ArtifactsPreviewPage(){
  if(process.env.NODE_ENV!=="development")notFound();
  return <ArtifactsPreview/>;
}
