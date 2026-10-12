// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  FunctionSecretsMissingError,
  FunctionsBundlerUnavailableError,
  FunctionsDeployFailedError,
  FunctionsDoNotCompileError,
  functionsPublishErrorBody,
} from "./publish-errors";

describe("functionsPublishErrorBody", () => {
  it("cada fallo, con su estado y lo que necesita la tarjeta", () => {
    expect(functionsPublishErrorBody(new FunctionsDoNotCompileError([{ ruta: "/supabase/functions/checkout/index.ts", linea: 3, columna: 5, gravedad: "Error", mensaje: 'Expected ";"' }]))).toEqual({
      status: 422,
      body: { error: "functions_do_not_compile", errors: ['/supabase/functions/checkout/index.ts:3:5 — Expected ";"'] },
    });
    expect(functionsPublishErrorBody(new FunctionSecretsMissingError(["STRIPE_SECRET_KEY"]))).toEqual({ status: 428, body: { error: "secrets_required", missing: ["STRIPE_SECRET_KEY"] } });
    expect(functionsPublishErrorBody(new FunctionsBundlerUnavailableError())).toEqual({ status: 503, body: { error: "functions_bundler_unavailable" } });
    expect(functionsPublishErrorBody(new FunctionsDeployFailedError(new Error("x")))).toEqual({ status: 502, body: { error: "functions_deploy_failed" } });
    expect(functionsPublishErrorBody(new Error("otro"))).toBeNull();
  });
});
