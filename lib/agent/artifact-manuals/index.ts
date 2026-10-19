import { dashboardManual } from "./dashboard";
import { slidesManual } from "./slides";
import { imageManual } from "./image";
import { motionManual } from "./motion";
import {audioManual} from "./audio";
export const ARTIFACT_MANUAL_INDEX = `PROJECT DELIVERABLES:
When asked to make a dashboard, presentation, promotional image, audio/narration or motion video about this project, use create_artifact for each requested piece. Normal conversation selects the capability; no selector, @mention or separate agent is required. A discussion about videos is not a request to create one.
Read /.openlen/docs/artifacts/<kind>.md before authoring that kind (dashboard, slides, image, motion, audio). The tool's kind enum lists the renderers this server actually has. Work in /.len/artifacts/<id>/, never in the original app's files for a deliverable request. For narrated video, generate one audio item first, inspect its verified duration, and reuse its exact ready revision in motion; music/effects come from uploaded tracks, not OpenAI generation.
Use list_artifacts/inspect_artifact to recover saved ids, versions and real status. Two images are two identities with different stable item_key values. Pin dependencies by exact artifactId/revision; reuse saved assets instead of regenerating them.
Write/edit sources with the existing file tools. render_artifact seals the returned revision and queues work; queued is not done. Only a completed job with verified saved outputs is ready. Preserve successful pieces when another fails. Cancel only the job the user asked to cancel.
query_artifact_data saves a dated dataset. Hypothetical values are scenario data and must stay labeled as such in charts, CSV and exports. Real owner data is private and read-only, including draft. An unavailable source is not a reason to invent real metrics. Refresh creates another saved dataset/version.
Do not claim preview/export availability from a chat sentence or show_widget: the durable job and saved outputs are the authority.`;
export const artifactManuals: Readonly<Record<string, string>> = Object.fromEntries(Object.entries({ dashboard: dashboardManual, slides: slidesManual, image: imageManual, motion: motionManual,audio:audioManual }).map(([kind, content]) => [`/.openlen/docs/artifacts/${kind}.md`, content]));
