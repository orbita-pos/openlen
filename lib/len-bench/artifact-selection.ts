import type {ArtifactKind} from "../artifacts/types";
export interface SelectionArtifact {readonly id:string;readonly kind:string;readonly itemKey:string|null;readonly status:string}
/** A selection score is deliberately not an export/provider quality score. */
export function gradeArtifactSelection(expected:Partial<Record<ArtifactKind,number>>,before:readonly SelectionArtifact[],after:readonly SelectionArtifact[],turn:{assistantResponded:boolean;sourceUnchanged:boolean;allowSourceChange?:boolean;error?:boolean}){
  const existing=new Set(before.map(a=>a.id)),created=after.filter(a=>!existing.has(a.id));
  const actual=Object.fromEntries(["dashboard","slides","image","motion"].map(kind=>[kind,created.filter(a=>a.kind===kind).length]));
  const counts=Object.keys(actual).every(kind=>actual[kind]===(expected[kind as ArtifactKind]??0));
  const keys=created.map(a=>a.itemKey);
  const selectionPassed=counts&&new Set(keys).size===keys.length&&keys.every(Boolean)&&turn.assistantResponded&&!turn.error&&(turn.sourceUnchanged||turn.allowSourceChange===true);
  return {selectionPassed,actual,created:created.map(a=>({id:a.id,kind:a.kind,itemKey:a.itemKey,status:a.status})),ready:created.filter(a=>a.status==="ready").length,formatsVerified:false as const};
}
