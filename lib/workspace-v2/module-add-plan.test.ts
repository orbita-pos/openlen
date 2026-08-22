import { describe, expect, it } from "vitest";
import { planModuleAdd } from "./module-add-plan";

describe("planModuleAdd", () => {
  it("módulo apagado + sección → enable + insert", () => {
    expect(planModuleAdd({ module: "collections", destination: "section", moduleEnabled: false, activePageHasBand: false }))
      .toEqual([{ kind: "enableModule", module: "collections" }, { kind: "insertSection", module: "collections" }]);
  });
  it("módulo ya encendido + sección → solo insert", () => {
    expect(planModuleAdd({ module: "collections", destination: "section", moduleEnabled: true, activePageHasBand: false }))
      .toEqual([{ kind: "insertSection", module: "collections" }]);
  });
  it("destino página → createPage (y activa si estaba apagado)", () => {
    expect(planModuleAdd({ module: "collections", destination: "page", moduleEnabled: false, activePageHasBand: false }))
      .toEqual([{ kind: "enableModule", module: "collections" }, { kind: "createPage", module: "collections" }]);
  });
  it("singleton: la página activa ya tiene la banda → solo scroll", () => {
    expect(planModuleAdd({ module: "collections", destination: "section", moduleEnabled: true, activePageHasBand: true }))
      .toEqual([{ kind: "scrollToExisting", module: "collections" }]);
  });
  it("destino página IGNORA la banda de la página activa (página nueva es otra superficie)", () => {
    expect(planModuleAdd({ module: "collections", destination: "page", moduleEnabled: true, activePageHasBand: true }))
      .toEqual([{ kind: "createPage", module: "collections" }]);
  });
  it("platforms + destino página lanza (no existe esa superficie)", () => {
    expect(() => planModuleAdd({ module: "platforms", destination: "page", moduleEnabled: true, activePageHasBand: false })).toThrow();
  });
});

describe("planModuleAdd — plataformas (prerequisito = datos, no toggle)", () => {
  const base = { module: "platforms", destination: "section", moduleEnabled: false, activePageHasBand: false } as const;

  it("con links → insert directo, SIN enableModule (no hay settings.enabled)", () => {
    expect(planModuleAdd({ ...base, hasPlatformLinks: true }))
      .toEqual([{ kind: "insertSection", module: "platforms" }]);
  });
  it("sin links → dirige a Mi negocio y NO inserta", () => {
    expect(planModuleAdd({ ...base, hasPlatformLinks: false }))
      .toEqual([{ kind: "openBusinessProfile" }]);
  });
  it("hasPlatformLinks ausente cuenta como sin links", () => {
    expect(planModuleAdd(base)).toEqual([{ kind: "openBusinessProfile" }]);
  });
  it("singleton: la banda ya está en la página activa → solo scroll", () => {
    expect(planModuleAdd({ ...base, hasPlatformLinks: true, activePageHasBand: true }))
      .toEqual([{ kind: "scrollToExisting", module: "platforms" }]);
  });
  it("el singleton gana incluso sin links (la banda ya existe, no hay nada que capturar)", () => {
    expect(planModuleAdd({ ...base, activePageHasBand: true }))
      .toEqual([{ kind: "scrollToExisting", module: "platforms" }]);
  });
  it("moduleEnabled NO influye — el estado son los links", () => {
    expect(planModuleAdd({ ...base, moduleEnabled: true, hasPlatformLinks: false }))
      .toEqual([{ kind: "openBusinessProfile" }]);
  });
  it("platforms + destino página lanza (no habrá página de plataformas)", () => {
    expect(() => planModuleAdd({ ...base, destination: "page", hasPlatformLinks: true })).toThrow();
  });
});
