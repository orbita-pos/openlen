import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const TEMPLATE_STORAGE_KEY = /^templates\/[a-z0-9]+(?:[-_][a-z0-9]+)*-[a-f0-9]{12}\.html$/;

interface TemplateObjectEnvironment {
  [key: string]: string | undefined;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY?: string;
  R2_SECRET_KEY?: string;
  R2_TEMPLATES_BUCKET?: string;
  TEMPLATES_DIR?: string;
}

interface R2ReadRequest {
  accountId: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  key: string;
}

interface TemplateObjectReaderDeps {
  env: TemplateObjectEnvironment;
  readR2(request: R2ReadRequest): Promise<string>;
  readFile(path: string): Promise<string>;
}

async function readR2Object(request: R2ReadRequest): Promise<string> {
  const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${request.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: request.accessKey,
      secretAccessKey: request.secretKey,
    },
  });
  const result = await client.send(new GetObjectCommand({
    Bucket: request.bucket,
    Key: request.key,
  }));
  if (!result.Body) throw new Error("template_object_unavailable");
  return result.Body.transformToString("utf8");
}

const DEFAULT_DEPS: TemplateObjectReaderDeps = {
  env: process.env,
  readR2: readR2Object,
  readFile: (path) => readFile(path, "utf8"),
};

export async function readTemplateObjectText(
  storageKey: string,
  deps: TemplateObjectReaderDeps = DEFAULT_DEPS,
): Promise<string> {
  if (!TEMPLATE_STORAGE_KEY.test(storageKey)) {
    throw new Error("invalid_template_storage_key");
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY } = deps.env;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return deps.readR2({
      accountId: R2_ACCOUNT_ID,
      accessKey: R2_ACCESS_KEY,
      secretKey: R2_SECRET_KEY,
      bucket: deps.env.R2_TEMPLATES_BUCKET || "openlen-templates",
      key: storageKey,
    });
  }
  return deps.readFile(resolve(deps.env.TEMPLATES_DIR || "./public/template-objects", storageKey));
}
