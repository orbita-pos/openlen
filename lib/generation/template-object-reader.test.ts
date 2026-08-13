import { describe, expect, it, vi } from "vitest";

import { readTemplateObjectText, TemplateObjectReadError } from "./template-object-reader";

describe("readTemplateObjectText", () => {
  it("reads template HTML from the R2 origin instead of the public CDN", async () => {
    const readR2 = vi.fn(async () => "<html>origin</html>");
    const readFile = vi.fn(async () => "<html>filesystem</html>");

    await expect(readTemplateObjectText("templates/mirror-aaaaaaaaaaaa.html", {
      env: {
        R2_ACCOUNT_ID: "account",
        R2_ACCESS_KEY: "access",
        R2_SECRET_KEY: "secret",
        R2_TEMPLATES_BUCKET: "templates",
      },
      readR2,
      readFile,
    })).resolves.toBe("<html>origin</html>");

    expect(readR2).toHaveBeenCalledWith({
      accountId: "account",
      accessKey: "access",
      secretKey: "secret",
      bucket: "templates",
      key: "templates/mirror-aaaaaaaaaaaa.html",
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads the exact object from the filesystem fallback and rejects traversal", async () => {
    const readFile = vi.fn(async () => "<html>local</html>");
    await expect(readTemplateObjectText("templates/mirror-aaaaaaaaaaaa.html", {
      env: { TEMPLATES_DIR: "C:/templates" },
      readR2: vi.fn(),
      readFile,
    })).resolves.toBe("<html>local</html>");
    expect(readFile).toHaveBeenCalledWith("C:\\templates\\templates\\mirror-aaaaaaaaaaaa.html");

    await expect(readTemplateObjectText("../secret", {
      env: {}, readR2: vi.fn(), readFile,
    })).rejects.toThrow("invalid_template_storage_key");
  });

  it("returns null when the canonical object is absent locally or in R2", async () => {
    await expect(readTemplateObjectText("templates/mirror-aaaaaaaaaaaa.html", {
      env: {},
      readR2: vi.fn(),
      readFile: vi.fn(async () => { throw Object.assign(new Error("private local path"), { code: "ENOENT" }); }),
    })).resolves.toBeNull();

    await expect(readTemplateObjectText("templates/mirror-aaaaaaaaaaaa.html", {
      env: {
        R2_ACCOUNT_ID: "account",
        R2_ACCESS_KEY: "access",
        R2_SECRET_KEY: "secret",
      },
      readR2: vi.fn(async () => { throw Object.assign(new Error("private bucket detail"), { name: "NoSuchKey" }); }),
      readFile: vi.fn(),
    })).resolves.toBeNull();
  });

  it("maps operational failures to a typed redacted error", async () => {
    const error = await readTemplateObjectText("templates/mirror-aaaaaaaaaaaa.html", {
      env: {},
      readR2: vi.fn(),
      readFile: vi.fn(async () => { throw new Error("C:\\private\\templates\\credential.txt"); }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TemplateObjectReadError);
    expect(error).toMatchObject({
      name: "TemplateObjectReadError",
      code: "template_object_unavailable",
      message: "template_object_unavailable",
    });
    expect(String(error)).not.toContain("private");
    expect(JSON.stringify(error)).not.toContain("credential");
  });
});
