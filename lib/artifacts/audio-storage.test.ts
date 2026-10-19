// @vitest-environment node
import {afterEach,expect,it,vi} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {S3Client} from "@aws-sdk/client-s3";
import {LocalFsAssetStorage,S3AssetStorage} from "../projects/assets";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it("bounds project upload reads in local storage before buffering the whole file",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"len-audio-storage-"));vi.stubEnv("OPENLEN_UPLOAD_DIR",dir);
  try{const storage=new LocalFsAssetStorage(),item=await storage.put("project",Buffer.alloc(64),"wav","audio/wav");expect(await storage.get("project",item.filename,32)).toBeNull();expect((await storage.get("project",item.filename,64))?.contents.length).toBe(64);}finally{await rm(dir,{recursive:true,force:true});}
});
it("stops a cloud audio stream when its actual bytes exceed the bound even if metadata lies",async()=>{
  vi.stubEnv("S3_BUCKET","test");vi.stubEnv("S3_ACCESS_KEY_ID","test");vi.stubEnv("S3_SECRET_ACCESS_KEY","test");vi.stubEnv("S3_PUBLIC_URL_BASE","https://storage.invalid");
  let reads=0,closed=false;
  async function* chunks(){try{for(let i=0;i<10;i++){reads++;yield Buffer.alloc(20);}}finally{closed=true;}}
  vi.spyOn(S3Client.prototype,"send").mockResolvedValue({Body:chunks(),ContentType:"audio/wav",ContentLength:1} as never);
  const storage=new S3AssetStorage();expect(await storage.get("project","file.wav",32)).toBeNull();expect(reads).toBe(2);expect(closed).toBe(true);
});
