import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const TEMPLATE_STORAGE_KEY = /^(?:templates|sections)\/[a-z0-9]+(?:[-_][a-z0-9]+)*-[a-f0-9]{12}\.html$/;

export type TemplateObjectReadErrorCode =
  | "invalid_template_storage_key"
  | "template_object_unavailable";

export class TemplateObjectReadError extends Error {
  constructor(readonly code: TemplateObjectReadErrorCode) {
    super(code);
    this.name = "TemplateObjectReadError";
  }
}

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
  readR2(request: R2ReadRequest): Promise<string | null>;
  readFile(path: string): Promise<string | null>;
}

async function readR2Object(request: R2ReadRequest): Promise<string | null> {
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
  if (!result.Body) return null;
  return result.Body.transformToString("utf8");
}

const DEFAULT_DEPS: TemplateObjectReaderDeps = {
  env: process.env,
  readR2: readR2Object,
  readFile: (path) => readFile(path, "utf8"),
};

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const metadata = record.$metadata;
  const status = metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>).httpStatusCode
    : undefined;
  return record.code === "ENOENT"
    || record.name === "NoSuchKey"
    || record.name === "NotFound"
    || status === 404;
}

export async function readTemplateObjectText(
  storageKey: string,
  deps: TemplateObjectReaderDeps = DEFAULT_DEPS,
): Promise<string | null> {
  if (!TEMPLATE_STORAGE_KEY.test(storageKey)) {
    throw new TemplateObjectReadError("invalid_template_storage_key");
  }
  try {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY } = deps.env;
    if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
      return await deps.readR2({
        accountId: R2_ACCOUNT_ID,
        accessKey: R2_ACCESS_KEY,
        secretKey: R2_SECRET_KEY,
        bucket: deps.env.R2_TEMPLATES_BUCKET || "openlen-templates",
        key: storageKey,
      });
    }
    return await deps.readFile(resolve(deps.env.TEMPLATES_DIR || "./public/template-objects", storageKey));
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw new TemplateObjectReadError("template_object_unavailable");
  }
}
