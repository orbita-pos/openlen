// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { openaiArtifactImageTransport } from "./openai";
import { generateArtifactImage } from "./render";
import { validateArtifactImage } from "./validate";
import type { SealedArtifactInput, ArtifactAdapterHooks } from "../../types";
import { imageGenerationCostMicroUsd } from "../../../ai/cost-rates";
const input = { artifact:{kind:"image"}, revision:{files:{"image.json":JSON.stringify({version:1,prompt:"Promociona mi app",width:1024,height:1024,format:"png",quality:"medium",references:[]})}},assets:[],datasets:[],jobOptions:{formats:["png"]} } as unknown as SealedArtifactInput;
const signal = () => new AbortController().signal;
it("prices actual direct-Images usage by modality without a cached-input discount or a guessed flat cost",()=>{
  expect(imageGenerationCostMicroUsd("gpt-image-2",{input_tokens:110,input_tokens_details:{text_tokens:10,image_tokens:100,cached_tokens:100},output_tokens:1000})).toBe(30850);
  expect(imageGenerationCostMicroUsd("other-model",{input_tokens:0,output_tokens:100})).toBeNull();
  expect(imageGenerationCostMicroUsd("gpt-image-2",{input_tokens:110,output_tokens:1000})).toBeNull();
});
it("sends one explicit gpt-image-2 generation, never fetches returned URLs and never retries a timeout", async () => {
  const calls: {url:string;body:Record<string,unknown>}[]=[];
  const transport=openaiArtifactImageTransport({apiKey:"test",model:"gpt-image-2",fetch:async(url,options)=>{calls.push({url:String(url),body:JSON.parse(String(options?.body))});return new Response(JSON.stringify({data:[{url:"https://untrusted.invalid/image"}],usage:{input_tokens:10}}));}});
  const reply=await transport({prompt:"Demo",width:1024,height:1024,format:"png",quality:"medium",references:[]},signal());
  expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:"https://api.openai.com/v1/images/generations",body:{model:"gpt-image-2",n:1,size:"1024x1024",output_format:"png",quality:"medium"}});
  expect(reply.outcome).toBe("failed");
  let attempts=0;
  const timeout=openaiArtifactImageTransport({apiKey:"test",model:"gpt-image-2",fetch:async()=>{attempts++;throw new Error("timeout");}});
  expect((await timeout({prompt:"Demo",width:1024,height:1024,format:"png",quality:"medium",references:[]},signal())).outcome).toBe("unknown");expect(attempts).toBe(1);
});
it("records a definite content rejection without claiming an image or charging a success", async()=>{
  const transport=openaiArtifactImageTransport({apiKey:"test",model:"gpt-image-2",fetch:async()=>new Response(JSON.stringify({error:{code:"content_policy_violation"}}),{status:400})});
  const events:unknown[]=[];
  const hooks:ArtifactAdapterHooks={beforeExternalCall:async()=>{events.push("started");},recordExternalOutcome:async(x)=>{events.push(x.outcome);}};
  await expect(generateArtifactImage(input,{transport,model:"gpt-image-2"},signal(),hooks)).rejects.toMatchObject({code:"image_content_rejected"});
  expect(events).toEqual(["started","rejected"]);
});
it("sends authorized reference bytes as multipart and accepts only one complete base64 image",async()=>{
  const bytes=new Uint8Array(await readFile(new URL("../../../../public/icon-512.png",import.meta.url)));
  const transport=openaiArtifactImageTransport({apiKey:"test",model:"gpt-image-2",fetch:async(url,options)=>{
    expect(String(url)).toBe("https://api.openai.com/v1/images/edits");
    const form=options!.body as FormData;expect(form.get("model")).toBe("gpt-image-2");expect(form.getAll("image[]")).toHaveLength(1);
    expect(new Uint8Array(await (form.get("image[]") as Blob).arrayBuffer())).toEqual(bytes);
    return new Response(JSON.stringify({data:[{b64_json:Buffer.from(bytes).toString("base64")}],usage:{input_tokens:10,input_tokens_details:{text_tokens:10,image_tokens:0},output_tokens:100}}),{headers:{"x-request-id":"req_test"}});
  }});
  const reply=await transport({prompt:"Demo",width:1024,height:1024,format:"png",quality:"medium",references:[{id:"pinned",mime:"image/png",bytes}]},signal());
  expect(reply).toMatchObject({outcome:"succeeded",bytes,requestId:"req_test",costMicroUsd:3050});
});
it("checks real decoded dimensions and rejects MIME corruption", async()=>{
  const bytes=new Uint8Array(await readFile(new URL("../../../../public/icon-512.png",import.meta.url)));
  await expect(validateArtifactImage(bytes,"png",512,512)).resolves.toMatchObject({width:512,height:512});
  await expect(validateArtifactImage(bytes,"jpeg",512,512)).rejects.toMatchObject({code:"image_mime_mismatch"});
  await expect(validateArtifactImage(bytes,"png",1024,1024)).rejects.toMatchObject({code:"image_dimensions_mismatch"});
  await expect(validateArtifactImage(bytes.slice(0,60),"png",512,512)).rejects.toMatchObject({code:"invalid_image_bytes"});
});
it("rejects an unresolved reference or mismatched format before making a paid call",async()=>{
  let calls=0;
  const transport=async()=>{calls++;throw new Error("unexpected");};
  const hooks:ArtifactAdapterHooks={beforeExternalCall:async()=>{},recordExternalOutcome:async()=>{}};
  const wrong={...input,jobOptions:{formats:["webp"]}};
  await expect(generateArtifactImage(wrong,{transport,model:"gpt-image-2"},signal(),hooks)).rejects.toMatchObject({code:"image_format_mismatch"});
  const ref={...input,revision:{...input.revision,files:{"image.json":JSON.stringify({version:1,prompt:"Demo",width:1024,height:1024,format:"png",quality:"medium",references:["foreign@1/0"]})}}};
  await expect(generateArtifactImage(ref,{transport,model:"gpt-image-2"},signal(),hooks)).rejects.toMatchObject({code:"image_reference_missing"});expect(calls).toBe(0);
});
