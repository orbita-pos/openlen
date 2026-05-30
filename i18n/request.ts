import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// Messages are split into one JSON file per namespace per locale so the
// translation work can be parallelised without merge conflicts. They're
// statically imported (bundler-safe + type-safe) and assembled into the
// nested shape next-intl expects: { en: { common: {...}, ... }, es: {...} }.
import enCommon from "../messages/en/common.json";
import enFamilies from "../messages/en/families.json";
import enMarketing from "../messages/en/marketing.json";
import enPages from "../messages/en/pages.json";
import enAuth from "../messages/en/auth.json";
import enProjects from "../messages/en/projects.json";
import enSections from "../messages/en/sections.json";
import enWsPage from "../messages/en/wsPage.json";
import enWsChrome from "../messages/en/wsChrome.json";
import enTopbar from "../messages/en/topbar.json";
import enPanelsChat from "../messages/en/panelsChat.json";
import enPanelsProps from "../messages/en/panelsProps.json";
import enPanelsA from "../messages/en/panelsA.json";
import enPanelsB from "../messages/en/panelsB.json";
import enModalsAsset from "../messages/en/modalsAsset.json";
import enModalsDomain from "../messages/en/modalsDomain.json";
import enModalsDeploy from "../messages/en/modalsDeploy.json";

import esCommon from "../messages/es/common.json";
import esFamilies from "../messages/es/families.json";
import esMarketing from "../messages/es/marketing.json";
import esPages from "../messages/es/pages.json";
import esAuth from "../messages/es/auth.json";
import esProjects from "../messages/es/projects.json";
import esSections from "../messages/es/sections.json";
import esWsPage from "../messages/es/wsPage.json";
import esWsChrome from "../messages/es/wsChrome.json";
import esTopbar from "../messages/es/topbar.json";
import esPanelsChat from "../messages/es/panelsChat.json";
import esPanelsProps from "../messages/es/panelsProps.json";
import esPanelsA from "../messages/es/panelsA.json";
import esPanelsB from "../messages/es/panelsB.json";
import esModalsAsset from "../messages/es/modalsAsset.json";
import esModalsDomain from "../messages/es/modalsDomain.json";
import esModalsDeploy from "../messages/es/modalsDeploy.json";

const MESSAGES = {
  en: {
    common: enCommon,
    families: enFamilies,
    marketing: enMarketing,
    pages: enPages,
    auth: enAuth,
    projects: enProjects,
    sections: enSections,
    wsPage: enWsPage,
    wsChrome: enWsChrome,
    topbar: enTopbar,
    panelsChat: enPanelsChat,
    panelsProps: enPanelsProps,
    panelsA: enPanelsA,
    panelsB: enPanelsB,
    modalsAsset: enModalsAsset,
    modalsDomain: enModalsDomain,
    modalsDeploy: enModalsDeploy,
  },
  es: {
    common: esCommon,
    families: esFamilies,
    marketing: esMarketing,
    pages: esPages,
    auth: esAuth,
    projects: esProjects,
    sections: esSections,
    wsPage: esWsPage,
    wsChrome: esWsChrome,
    topbar: esTopbar,
    panelsChat: esPanelsChat,
    panelsProps: esPanelsProps,
    panelsA: esPanelsA,
    panelsB: esPanelsB,
    modalsAsset: esModalsAsset,
    modalsDomain: esModalsDomain,
    modalsDeploy: esModalsDeploy,
  },
} as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: MESSAGES[locale],
  };
});
