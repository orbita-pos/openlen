// What an event task watches, as a translation key and its values: one place for the web's clock and the phone's
// «Tareas» (spec local 2026-11-04-hazlo, §7.4).
import { describe, expect, it } from "vitest";

import { sourceLabel } from "./source-label";

describe("sourceLabel", () => {
  it("names the first two sources as before", () => {
    expect(sourceLabel({ source: "app_rows", params: { table: "reservas" } })).toEqual({ key: "sourceRows", values: { table: "reservas" } });
    expect(sourceLabel({ source: "form_submissions", params: { form: "fab12" } })).toEqual({ key: "sourceForm", values: { form: "fab12" } });
    expect(sourceLabel({ source: "form_submissions", params: {} })).toEqual({ key: "sourceAllForms" });
  });

  it("app_rows with after_hours says it waits", () => {
    expect(sourceLabel({ source: "app_rows", params: { table: "reservas", after_hours: 24 } })).toEqual({ key: "sourceRowsAfter", values: { table: "reservas", hours: "24" } });
  });

  it("traffic names its page or the site", () => {
    expect(sourceLabel({ source: "traffic", params: { page: "menu" } })).toEqual({ key: "sourceTraffic", values: { page: "menu" } });
    expect(sourceLabel({ source: "traffic", params: {} })).toEqual({ key: "sourceTrafficSite" });
  });

  it("github says what it watches", () => {
    expect(sourceLabel({ source: "github", params: {} })).toEqual({ key: "sourceGithub" });
  });

  it("app_users says sign-ups", () => {
    expect(sourceLabel({ source: "app_users", params: {} })).toEqual({ key: "sourceAppUsers" });
  });

  it("visitor_chat says messages or signups", () => {
    expect(sourceLabel({ source: "visitor_chat", params: {} })).toEqual({ key: "sourceChatMessages" });
    expect(sourceLabel({ source: "visitor_chat", params: { watch: "signups" } })).toEqual({ key: "sourceChatSignups" });
  });
});
