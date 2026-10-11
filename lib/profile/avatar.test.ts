import { describe, expect, it } from "vitest";

import { avatarKeyFor, avatarKeyFromUrl, avatarOf, checkAvatarFile } from "./avatar";

const USER = "1b2c3d4e-0000-4000-8000-0123456789ab";

describe("qué foto es la de cada persona", () => {
  it("🔴 la subida gana a la de Google, y sin ninguna, null (la inicial)", () => {
    expect(avatarOf({ avatarUrl: "https://u/a.webp", image: "https://g/p.jpg" })).toBe("https://u/a.webp");
    expect(avatarOf({ avatarUrl: null, image: "https://g/p.jpg" })).toBe("https://g/p.jpg");
    expect(avatarOf({ avatarUrl: "", image: "" })).toBeNull();
    expect(avatarOf({})).toBeNull();
  });
});

describe("el fichero de la foto en el almacén", () => {
  it("la clave lleva el usuario y el hash", () => {
    expect(avatarKeyFor(USER, "0123456789abcdef")).toBe(`avatars/${USER}-0123456789abcdef.webp`);
  });

  it("🔴 de una URL nuestra sale su clave (R2 y disco local)", () => {
    expect(avatarKeyFromUrl(`https://uploads.openlen.com/avatars/${USER}-0123456789abcdef.webp`, USER)).toBe(
      `avatars/${USER}-0123456789abcdef.webp`,
    );
    expect(avatarKeyFromUrl(`/uploads/avatars/${USER}-0123456789abcdef.webp?v=1`, USER)).toBe(
      `avatars/${USER}-0123456789abcdef.webp`,
    );
  });

  it("🔴 nunca la de otro sitio ni la de otra persona: eso no se borra", () => {
    expect(avatarKeyFromUrl("https://lh3.googleusercontent.com/a/ACg8ocK", USER)).toBeNull();
    expect(avatarKeyFromUrl("https://openlen.com/icon-192.png", USER)).toBeNull();
    expect(avatarKeyFromUrl(`https://uploads.openlen.com/avatars/otro-0123456789abcdef.webp`, USER)).toBeNull();
    expect(avatarKeyFromUrl(`https://uploads.openlen.com/uploads/x/${USER}-0123456789abcdef.webp`, USER)).toBeNull();
  });
});

describe("qué fichero se acepta", () => {
  it("JPG, PNG y WebP hasta 5 MB; GIF no", () => {
    expect(checkAvatarFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(checkAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 })).toBeNull();
    expect(checkAvatarFile({ type: "image/webp", size: 10 })).toBeNull();
    expect(checkAvatarFile({ type: "image/gif", size: 10 })).toBe("bad_type");
    expect(checkAvatarFile({ type: "", size: 10 })).toBe("bad_type");
    expect(checkAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toBe("too_big");
  });
});
