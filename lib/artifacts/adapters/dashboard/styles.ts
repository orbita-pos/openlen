import {generateTailwindCss} from "../../../publish/tailwind-css";
import {ArtifactError} from "../../types";
/** Same offline Tailwind compiler as publication, with data-only config. */
export async function artifactCss(css:string,files:Readonly<Record<string,string>>){
 if(/@import\b|url\s*\(\s*(?!["']?data:)/i.test(css))throw new ArtifactError("artifact_resource_missing");
 try{return await generateTailwindCss("",{},Object.entries(files).filter(([p])=>/\.(?:html|[jt]sx?)$/.test(p)).map(([p,raw])=>({raw,extension:p.split(".").at(-1)!})),[css],"class");}
 catch{throw new ArtifactError("artifact_compile_failed","Local CSS/Tailwind could not compile.");}
}
