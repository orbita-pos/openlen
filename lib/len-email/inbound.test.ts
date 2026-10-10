// @vitest-environment node
import { describe, expect, it } from "vitest";

import { contextForModel, detectLanguage, isAuthentic, isAutomatic, mailboxAddress, newReplyText } from "./inbound";

describe("quién lo manda", () => {
  it("lee la dirección con o sin nombre", () => {
    expect(mailboxAddress("Ana Pérez <Ana@Gmail.com>")).toBe("ana@gmail.com");
    expect(mailboxAddress("ana@gmail.com")).toBe("ana@gmail.com");
    expect(mailboxAddress("sin correo")).toBeNull();
  });

  it("🔴 las respuestas automáticas, los rebotes y las listas no se contestan (bucle)", () => {
    expect(isAutomatic({ from: "ana@x.com", autoSubmitted: "auto-replied" })).toBe(true);
    expect(isAutomatic({ from: "ana@x.com", precedence: "bulk" })).toBe(true);
    expect(isAutomatic({ from: "ana@x.com", listId: "<news.x.com>" })).toBe(true);
    expect(isAutomatic({ from: "MAILER-DAEMON@x.com" })).toBe(true);
    expect(isAutomatic({ from: "no-reply@x.com" })).toBe(true);
    expect(isAutomatic({ from: "ana@x.com", autoSubmitted: "no" })).toBe(false);
    expect(isAutomatic({ from: "Ana <ana@x.com>" })).toBe(false);
  });
});

describe("¿es de verdad de su From?", () => {
  const cf = "mx.cloudflare.net";
  it("🔴 vale dmarc=pass o dkim=pass alineados con el dominio del From", () => {
    expect(isAuthentic("mx.cloudflare.net; dkim=pass header.d=gmail.com header.s=20230601; spf=pass smtp.mailfrom=ana@gmail.com; dmarc=pass header.from=gmail.com", "ana@gmail.com", cf)).toBe(true);
    expect(isAuthentic("mx.cloudflare.net; dkim=pass header.d=empresa.mx", "ana@empresa.mx", cf)).toBe(true);
    // ARC: lo mismo con `i=N;` delante.
    expect(isAuthentic("i=1; mx.cloudflare.net; dmarc=pass header.from=gmail.com", "ana@gmail.com", cf)).toBe(true);
  });

  it("🔴 no vale: DKIM de OTRO dominio, sólo SPF, un fallo, o una cabecera que no firmó nuestro receptor", () => {
    expect(isAuthentic("mx.cloudflare.net; dkim=pass header.d=evil.com; dmarc=fail header.from=gmail.com", "ana@gmail.com", cf)).toBe(false);
    expect(isAuthentic("mx.cloudflare.net; spf=pass smtp.mailfrom=ana@gmail.com", "ana@gmail.com", cf)).toBe(false);
    expect(isAuthentic("mx.cloudflare.net; dkim=fail header.d=gmail.com; dmarc=fail header.from=gmail.com", "ana@gmail.com", cf)).toBe(false);
    // La pudo escribir el remitente: sólo cuenta la que firma nuestro receptor.
    expect(isAuthentic("mx.evil.com; dmarc=pass header.from=gmail.com", "ana@gmail.com", cf)).toBe(false);
    expect(isAuthentic(null, "ana@gmail.com", cf)).toBe(false);
  });
});

describe("lo que escribió, sin lo citado", () => {
  it("🔴 corta en el «escribió:» de Gmail (también partido en dos líneas)", () => {
    expect(newReplyText("Cambia el precio a 499\n\nEl jue, 9 oct 2026 a las 10:00, Len <len@openlen.com> escribió:\n> Listo, ya está.")).toBe("Cambia el precio a 499");
    expect(newReplyText("Pon la foto nueva\n\nOn Thu, Oct 9, 2026 at 10:00 AM Len <len@openlen.com>\nwrote:\n> Done.")).toBe("Pon la foto nueva");
  });

  it("corta en el bloque de Outlook, el separador y la firma; quita las líneas citadas", () => {
    expect(newReplyText("Quita la sección de precios\n\n________________________________\nDe: Len <len@openlen.com>\nEnviado: jueves")).toBe("Quita la sección de precios");
    expect(newReplyText("Hazlo azul\n-----Original Message-----\nFrom: Len")).toBe("Hazlo azul");
    expect(newReplyText("Hazlo azul\n\n-- \nAna Pérez\nCafé Luna")).toBe("Hazlo azul");
    expect(newReplyText("> lo de antes\nY también el teléfono")).toBe("Y también el teléfono");
  });

  it("un «De:» suelto en lo escrito no corta nada", () => {
    expect(newReplyText("De: lunes a viernes, abrimos a las 9.\nPonlo en el horario.")).toBe("De: lunes a viernes, abrimos a las 9.\nPonlo en el horario.");
  });
});

describe("el idioma de lo escrito", () => {
  it("lo adivina por sus palabras o su escritura", () => {
    expect(detectLanguage("cambia el precio de la página por favor")).toBe("es");
    expect(detectLanguage("¿puedes?")).toBe("es");
    expect(detectLanguage("please change the price on the page")).toBe("en");
    expect(detectLanguage("muda o preço da página, obrigado")).toBe("pt");
    expect(detectLanguage("価格を変えてください")).toBe("ja");
    expect(detectLanguage("가격을 바꿔 주세요")).toBe("ko");
    expect(detectLanguage("请修改价格")).toBe("zh");
    expect(detectLanguage("ok")).toBe("en");
  });
});

it("el contexto del modelo dice que nadie mira y lleva el asunto", () => {
  const c = contextForModel("  Re:   Precios  ");
  expect(c).toContain('subject: "Re: Precios"');
  expect(c).toMatch(/Nobody is watching/);
});
