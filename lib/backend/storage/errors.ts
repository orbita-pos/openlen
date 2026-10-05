// Los errores de Supabase Storage, con sus códigos, estados y mensajes
// copiados de su código (supabase/storage @ eccef5e7, Apache-2.0):
// src/internal/errors/codes.ts (ERRORS), storage-error.ts (render) y
// src/http/error-handler.ts (el estado de la respuesta). Sólo los que usa
// /storage/v1 aquí.
//
// La forma que ve `storage-js`: estado 400 salvo los 500 (su `userStatusCode`),
// y en el cuerpo el estado «de verdad» como texto:
// `{ statusCode: "404", code: "NoSuchBucket", error: "Bucket not found", message: "Bucket not found" }`.

export interface StorageErrorOptions {
  readonly code: string;
  readonly httpStatusCode: number;
  readonly message: string;
  readonly error?: string;
}

export class StorageError extends Error {
  readonly code: string;
  readonly httpStatusCode: number;
  userStatusCode: number;
  readonly error?: string;

  constructor(o: StorageErrorOptions) {
    super(o.message);
    this.code = o.code;
    this.httpStatusCode = o.httpStatusCode;
    this.userStatusCode = o.httpStatusCode === 500 ? 500 : 400;
    this.error = o.error;
    Object.setPrototypeOf(this, StorageError.prototype);
  }

  withStatusCode(status: number): this {
    this.userStatusCode = status;
    return this;
  }

  render(): { statusCode: string; code: string; error: string; message: string } {
    return { statusCode: String(this.httpStatusCode), code: this.code, error: this.error || this.code, message: this.message };
  }
}

const e = (o: StorageErrorOptions) => new StorageError(o);

export const ERRORS = {
  BucketNotEmpty: () => e({ code: "ResourceNotEmpty", httpStatusCode: 409, message: "The bucket you tried to delete is not empty" }),
  FeatureNotEnabled: (feature: string) =>
    e({ code: "FeatureNotEnabled", httpStatusCode: 409, message: `The feature ${feature} is not enabled for this resource` }),
  NoSuchBucket: () => e({ code: "NoSuchBucket", error: "Bucket not found", httpStatusCode: 404, message: "Bucket not found" }),
  NoSuchKey: () => e({ code: "NoSuchKey", error: "not_found", httpStatusCode: 404, message: "Object not found" }),
  MissingParameter: (parameter: string) =>
    e({ code: "MissingParameter", httpStatusCode: 400, message: `Missing Required Parameter ${parameter}` }),
  InvalidParameter: (parameter: string, message?: string) =>
    e({ code: "InvalidParameter", httpStatusCode: 400, message: message || `Invalid Parameter ${parameter}` }),
  InvalidRequest: (message: string) => e({ code: "InvalidRequest", httpStatusCode: 400, message: message || "Invalid Request" }),
  InvalidJWT: (message?: string) => e({ code: "InvalidJWT", httpStatusCode: 400, message: message || "Invalid JWT" }),
  AccessDenied: (action: string) =>
    e({ code: "AccessDenied", error: "Unauthorized", httpStatusCode: 403, message: action || "Access denied" }),
  ResourceAlreadyExists: () =>
    e({ code: "ResourceAlreadyExists", error: "Duplicate", httpStatusCode: 409, message: "The resource already exists" }),
  InvalidSignature: (message?: string) => e({ code: "InvalidSignature", httpStatusCode: 400, message: message || "Invalid signature" }),
  ExpiredSignature: () => e({ code: "ExpiredToken", httpStatusCode: 400, message: "The provided token has expired." }),
  InvalidMimeType: (mimeType: string) =>
    e({ code: "InvalidMimeType", error: "invalid_mime_type", httpStatusCode: 415, message: `mime type ${mimeType} is not supported` }),
  InvalidRange: () => e({ code: "InvalidRange", error: "invalid_range", httpStatusCode: 400, message: "invalid range provided" }),
  EntityTooLarge: (entity = "object", limit = "the maximum allowed size") =>
    e({ code: "EntityTooLarge", error: "Payload too large", httpStatusCode: 413, message: `The ${entity} exceeded ${limit}` }),
  InternalError: (message?: string) => e({ code: "InternalError", httpStatusCode: 500, message: message || "Internal server error" }),
  InvalidBucketName: () => e({ code: "InvalidBucketName", error: "Invalid Input", httpStatusCode: 400, message: "Bucket name invalid" }),
  InvalidFileSizeLimit: () =>
    e({ code: "InvalidRequest", httpStatusCode: 400, message: "Invalid file size format, hint: use 20GB / 20MB / 30KB / 3B" }),
  InvalidUploadSignature: (message?: string) =>
    e({ code: "InvalidUploadSignature", httpStatusCode: 400, message: message || "Invalid upload Signature" }),
  InvalidKey: (key: string) => e({ code: "InvalidKey", httpStatusCode: 400, message: `Invalid key: ${key}` }),
  KeyAlreadyExists: () => e({ code: "KeyAlreadyExists", error: "Duplicate", httpStatusCode: 409, message: "The resource already exists" }),
  BucketAlreadyExists: () =>
    e({ code: "BucketAlreadyExists", error: "Duplicate", httpStatusCode: 409, message: "The resource already exists" }),
  NoContentProvided: (message?: string) => e({ code: "InvalidRequest", httpStatusCode: 400, message: message || "No content provided" }),
  DatabaseTimeout: () =>
    e({ code: "DatabaseTimeout", httpStatusCode: 544, message: "The connection to the database timed out" }).withStatusCode(544),
  ResourceLocked: () => e({ code: "ResourceLocked", httpStatusCode: 423, message: "The resource is locked" }),
  ResourceReferenced: (message: string) => e({ code: "ResourceReferenced", httpStatusCode: 409, message }),
  RelatedResourceNotFound: () => e({ code: "InvalidRequest", httpStatusCode: 404, message: "The related resource does not exist" }),
  DatabaseError: (message: string) => e({ code: "DatabaseError", httpStatusCode: 500, message }),
};

/** De un error de Postgres al de Supabase: src/storage/database/errors.ts
 *  (`DBError.fromDBError`). */
export function fromDbError(err: unknown): StorageError {
  const pg = err as { code?: string; message?: string; detail?: string };
  switch (pg.code) {
    case "42501":
      return ERRORS.AccessDenied(
        (pg.message ?? "").includes("row-level security") ? "new row violates row-level security policy" : (pg.message ?? ""),
      );
    case "23505":
      return ERRORS.ResourceAlreadyExists();
    case "23503":
      if (pg.detail?.includes("is still referenced from table")) {
        return ERRORS.ResourceReferenced("The resource could not be updated or removed due to a foreign key constraint");
      }
      return ERRORS.RelatedResourceNotFound();
    case "55P03":
      return ERRORS.ResourceLocked();
    case "57014":
      return ERRORS.DatabaseTimeout();
    case "22P02":
    case "22007":
    case "22008":
      return ERRORS.InvalidParameter("value", pg.message || "Invalid value format or type conversion failed");
    default:
      return ERRORS.DatabaseError(`database error, code: ${pg.code}`);
  }
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** La respuesta de un error, como su `setErrorHandler`. Lo que no es un
 *  StorageError (ni un error de Postgres) sale como su 500 genérico. */
export function storageErrorResponse(err: unknown): Response {
  let se: StorageError | null = null;
  if (err instanceof StorageError) se = err;
  else if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string" && /^[0-9A-Z]{5}$/.test((err as { code: string }).code)) {
    se = fromDbError(err);
  }
  if (!se) {
    console.error("[storage] error sin forma", err);
    return new Response(JSON.stringify({ statusCode: "500", error: "Internal", message: "Internal Server Error", code: "InternalError" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
  return new Response(JSON.stringify(se.render()), { status: se.userStatusCode, headers: JSON_HEADERS });
}
