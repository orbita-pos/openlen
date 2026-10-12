// @vitest-environment node
import { describe, expect, it } from "vitest";
import { storeCapture } from "@/lib/mcp/capture-store";
import { GET } from "./route";

const get = (id: string) => GET(new Request(`http://x/api/mcp/capture/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/mcp/capture/[id]", () => {
  it("la captura, con su tipo, privada y sin indexar", async () => {
    const id = storeCapture({ mimeType: "image/png", dataBase64: Buffer.from("png").toString("base64") });
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("png");
  });
  it("🔴 un id que no existe o con forma mala: 404", async () => {
    expect((await get("y".repeat(43))).status).toBe(404);
    expect((await get("../etc")).status).toBe(404);
  });
});
