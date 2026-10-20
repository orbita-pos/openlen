import {notFound} from "next/navigation";
import {HistoryPreview} from "./view";
export default function HistoryPreviewPage(){
  if(process.env.NODE_ENV!=="development")notFound();
  return <HistoryPreview/>;
}
