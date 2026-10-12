// @vitest-environment node
import { describe, expect, it } from "vitest";

import { benchPublishParams } from "./owner-publish";

describe("benchPublishParams", () => {
  it("🔴 publica como el dueño que pulsa «Publicar»: tablas sin copiar los datos de prueba, y funciones aunque falten secretos", () => {
    expect(benchPublishParams({ projectId: "p1", ownerId: "u1", subdomain: "prueba" })).toEqual({
      projectId: "p1",
      userId: "u1",
      subdomain: "prueba",
      languages: [],
      skipFlightCheck: true,
      dataChanges: { mode: "owner", copyDraftData: false },
      functions: { skipMissingSecrets: true },
    });
  });
});
