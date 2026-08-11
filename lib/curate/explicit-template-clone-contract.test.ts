import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getTemplate: vi.fn(),
  getTemplateHtml: vi.fn(),
  transformTemplateCached: vi.fn(),
  resolveProfileForCreation: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  createVersion: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/templates/store", () => ({
  getTemplate: mocks.getTemplate,
  getTemplateHtml: mocks.getTemplateHtml,
}));
vi.mock("@/lib/transform/template-cache", () => ({ transformTemplateCached: mocks.transformTemplateCached }));
vi.mock("@/lib/business-profiles/store", () => ({ resolveProfileForCreation: mocks.resolveProfileForCreation }));
vi.mock("@/lib/db", () => ({
  db: { insert: mocks.insert },
  schema: { projects: { id: "projects" } },
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));

import { POST } from "@/app/api/projects/from-template/route";

const TEMPLATE = {
  id: "selected-by-user",
  name: "Selected gallery design",
  family: "education",
  status: "published",
  pages: [],
  thumbnailUrl: "https://images.openlen.com/template.avif",
  screenshotUrl: null,
};
const RAW_HTML = '<!doctype html><html><head><title>Old</title></head><body onclick="alert(1)"><main>RAW</main><script>private()</script></body></html>';
const TRANSFORMED_HTML = '<!doctype html><html><head><title>Old</title><style>.feature-card{border-radius:16px;padding:24px;font-size:32px}</style></head><body onclick="private()"><main class="feature-card">TRANSFORMED-CURATED-BODY</main><script>private()</script></body></html>';
const PROFILE = {
  id: "profile-1",
  data: {
    brand: { accent: "#1166EE", logoUrl: null },
    contact: { whatsapp: "5512345678", phone: null, email: null, address: null, socials: null },
  },
};

function request(body: unknown = { templateId: TEMPLATE.id }): Promise<Response> {
  return POST(new Request("http://localhost/api/projects/from-template", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/projects/from-template explicit clone contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getTemplate.mockResolvedValue(TEMPLATE);
    mocks.getTemplateHtml.mockResolvedValue(RAW_HTML);
    mocks.transformTemplateCached.mockResolvedValue(TRANSFORMED_HTML);
    mocks.resolveProfileForCreation.mockResolvedValue(PROFILE);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockResolvedValue(undefined);
    mocks.createVersion.mockResolvedValue(undefined);
  });

  it("clones the published user-selected template with normalized, sanitized, seeded HTML and template tags", async () => {
    const response = await request({ templateId: TEMPLATE.id, profileId: "requested-profile" });
    const body = await response.json() as { projectId: string; title: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ projectId: expect.any(String), title: TEMPLATE.name });
    expect(mocks.getTemplateHtml).toHaveBeenCalledTimes(1);
    expect(mocks.getTemplateHtml).toHaveBeenCalledWith(TEMPLATE.id);
    expect(mocks.transformTemplateCached).toHaveBeenCalledWith(TEMPLATE.id, RAW_HTML, { timeoutMs: expect.any(Number) });
    expect(mocks.resolveProfileForCreation).toHaveBeenCalledWith("user-1", "requested-profile");
    expect(mocks.values).toHaveBeenCalledTimes(1);
    const persisted = mocks.values.mock.calls[0]![0];
    expect(persisted).toMatchObject({
      id: body.projectId,
      userId: "user-1",
      title: TEMPLATE.name,
      brief: `Curated template: ${TEMPLATE.name}`,
      thumbnailUrl: TEMPLATE.thumbnailUrl,
      tags: [TEMPLATE.id, "template", TEMPLATE.family],
      status: "draft",
      profileId: PROFILE.id,
    });
    expect(persisted.data.html).toContain("TRANSFORMED-CURATED-BODY");
    expect(persisted.data.html).toContain("data-ol-contact-widget");
    expect(persisted.data.html).toContain("wa.me/");
    expect(persisted.data.html).toContain("data-ol-radius");
    expect(persisted.data.html).toContain("var(--ol-r-");
    expect(persisted.data.html).not.toContain("data-ol-accent-applied");
    expect(persisted.data.html).not.toContain("private()");
    expect(persisted.data.html).not.toMatch(/onclick=/i);
    expect(mocks.createVersion).toHaveBeenCalledWith(expect.objectContaining({ projectId: body.projectId, html: persisted.data.html }));
  });

  it("rejects an unauthorized request before reading the template", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.getTemplate).not.toHaveBeenCalled();
    expect(mocks.getTemplateHtml).not.toHaveBeenCalled();
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("rejects an unknown or unpublished template without loading its body", async () => {
    mocks.getTemplate.mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "unknown_template", id: TEMPLATE.id });
    expect(mocks.getTemplateHtml).not.toHaveBeenCalled();
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("fails closed when the selected template body is unavailable", async () => {
    mocks.getTemplateHtml.mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "template_body_unavailable" });
    expect(mocks.transformTemplateCached).not.toHaveBeenCalled();
    expect(mocks.resolveProfileForCreation).not.toHaveBeenCalled();
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("returns a stable failure when persistence rejects", async () => {
    mocks.values.mockRejectedValue(new Error("private database failure"));
    const response = await request();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db_insert_failed" });
    expect(mocks.getTemplateHtml).toHaveBeenCalledTimes(1);
    expect(mocks.getTemplateHtml).toHaveBeenCalledWith(TEMPLATE.id);
    expect(mocks.values).toHaveBeenCalledTimes(1);
    expect(mocks.createVersion).not.toHaveBeenCalled();
  });
});
