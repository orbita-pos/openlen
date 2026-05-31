import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// One JSON file per namespace per locale, statically imported (bundler-safe +
// type-safe) and assembled into the nested shape next-intl expects.
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

import ptCommon from "../messages/pt/common.json";
import ptFamilies from "../messages/pt/families.json";
import ptMarketing from "../messages/pt/marketing.json";
import ptPages from "../messages/pt/pages.json";
import ptAuth from "../messages/pt/auth.json";
import ptProjects from "../messages/pt/projects.json";
import ptSections from "../messages/pt/sections.json";
import ptWsPage from "../messages/pt/wsPage.json";
import ptWsChrome from "../messages/pt/wsChrome.json";
import ptTopbar from "../messages/pt/topbar.json";
import ptPanelsChat from "../messages/pt/panelsChat.json";
import ptPanelsProps from "../messages/pt/panelsProps.json";
import ptPanelsA from "../messages/pt/panelsA.json";
import ptPanelsB from "../messages/pt/panelsB.json";
import ptModalsAsset from "../messages/pt/modalsAsset.json";
import ptModalsDomain from "../messages/pt/modalsDomain.json";
import ptModalsDeploy from "../messages/pt/modalsDeploy.json";

import frCommon from "../messages/fr/common.json";
import frFamilies from "../messages/fr/families.json";
import frMarketing from "../messages/fr/marketing.json";
import frPages from "../messages/fr/pages.json";
import frAuth from "../messages/fr/auth.json";
import frProjects from "../messages/fr/projects.json";
import frSections from "../messages/fr/sections.json";
import frWsPage from "../messages/fr/wsPage.json";
import frWsChrome from "../messages/fr/wsChrome.json";
import frTopbar from "../messages/fr/topbar.json";
import frPanelsChat from "../messages/fr/panelsChat.json";
import frPanelsProps from "../messages/fr/panelsProps.json";
import frPanelsA from "../messages/fr/panelsA.json";
import frPanelsB from "../messages/fr/panelsB.json";
import frModalsAsset from "../messages/fr/modalsAsset.json";
import frModalsDomain from "../messages/fr/modalsDomain.json";
import frModalsDeploy from "../messages/fr/modalsDeploy.json";

import deCommon from "../messages/de/common.json";
import deFamilies from "../messages/de/families.json";
import deMarketing from "../messages/de/marketing.json";
import dePages from "../messages/de/pages.json";
import deAuth from "../messages/de/auth.json";
import deProjects from "../messages/de/projects.json";
import deSections from "../messages/de/sections.json";
import deWsPage from "../messages/de/wsPage.json";
import deWsChrome from "../messages/de/wsChrome.json";
import deTopbar from "../messages/de/topbar.json";
import dePanelsChat from "../messages/de/panelsChat.json";
import dePanelsProps from "../messages/de/panelsProps.json";
import dePanelsA from "../messages/de/panelsA.json";
import dePanelsB from "../messages/de/panelsB.json";
import deModalsAsset from "../messages/de/modalsAsset.json";
import deModalsDomain from "../messages/de/modalsDomain.json";
import deModalsDeploy from "../messages/de/modalsDeploy.json";

import itCommon from "../messages/it/common.json";
import itFamilies from "../messages/it/families.json";
import itMarketing from "../messages/it/marketing.json";
import itPages from "../messages/it/pages.json";
import itAuth from "../messages/it/auth.json";
import itProjects from "../messages/it/projects.json";
import itSections from "../messages/it/sections.json";
import itWsPage from "../messages/it/wsPage.json";
import itWsChrome from "../messages/it/wsChrome.json";
import itTopbar from "../messages/it/topbar.json";
import itPanelsChat from "../messages/it/panelsChat.json";
import itPanelsProps from "../messages/it/panelsProps.json";
import itPanelsA from "../messages/it/panelsA.json";
import itPanelsB from "../messages/it/panelsB.json";
import itModalsAsset from "../messages/it/modalsAsset.json";
import itModalsDomain from "../messages/it/modalsDomain.json";
import itModalsDeploy from "../messages/it/modalsDeploy.json";

import jaCommon from "../messages/ja/common.json";
import jaFamilies from "../messages/ja/families.json";
import jaMarketing from "../messages/ja/marketing.json";
import jaPages from "../messages/ja/pages.json";
import jaAuth from "../messages/ja/auth.json";
import jaProjects from "../messages/ja/projects.json";
import jaSections from "../messages/ja/sections.json";
import jaWsPage from "../messages/ja/wsPage.json";
import jaWsChrome from "../messages/ja/wsChrome.json";
import jaTopbar from "../messages/ja/topbar.json";
import jaPanelsChat from "../messages/ja/panelsChat.json";
import jaPanelsProps from "../messages/ja/panelsProps.json";
import jaPanelsA from "../messages/ja/panelsA.json";
import jaPanelsB from "../messages/ja/panelsB.json";
import jaModalsAsset from "../messages/ja/modalsAsset.json";
import jaModalsDomain from "../messages/ja/modalsDomain.json";
import jaModalsDeploy from "../messages/ja/modalsDeploy.json";

import koCommon from "../messages/ko/common.json";
import koFamilies from "../messages/ko/families.json";
import koMarketing from "../messages/ko/marketing.json";
import koPages from "../messages/ko/pages.json";
import koAuth from "../messages/ko/auth.json";
import koProjects from "../messages/ko/projects.json";
import koSections from "../messages/ko/sections.json";
import koWsPage from "../messages/ko/wsPage.json";
import koWsChrome from "../messages/ko/wsChrome.json";
import koTopbar from "../messages/ko/topbar.json";
import koPanelsChat from "../messages/ko/panelsChat.json";
import koPanelsProps from "../messages/ko/panelsProps.json";
import koPanelsA from "../messages/ko/panelsA.json";
import koPanelsB from "../messages/ko/panelsB.json";
import koModalsAsset from "../messages/ko/modalsAsset.json";
import koModalsDomain from "../messages/ko/modalsDomain.json";
import koModalsDeploy from "../messages/ko/modalsDeploy.json";

import zhCommon from "../messages/zh/common.json";
import zhFamilies from "../messages/zh/families.json";
import zhMarketing from "../messages/zh/marketing.json";
import zhPages from "../messages/zh/pages.json";
import zhAuth from "../messages/zh/auth.json";
import zhProjects from "../messages/zh/projects.json";
import zhSections from "../messages/zh/sections.json";
import zhWsPage from "../messages/zh/wsPage.json";
import zhWsChrome from "../messages/zh/wsChrome.json";
import zhTopbar from "../messages/zh/topbar.json";
import zhPanelsChat from "../messages/zh/panelsChat.json";
import zhPanelsProps from "../messages/zh/panelsProps.json";
import zhPanelsA from "../messages/zh/panelsA.json";
import zhPanelsB from "../messages/zh/panelsB.json";
import zhModalsAsset from "../messages/zh/modalsAsset.json";
import zhModalsDomain from "../messages/zh/modalsDomain.json";
import zhModalsDeploy from "../messages/zh/modalsDeploy.json";

import nlCommon from "../messages/nl/common.json";
import nlFamilies from "../messages/nl/families.json";
import nlMarketing from "../messages/nl/marketing.json";
import nlPages from "../messages/nl/pages.json";
import nlAuth from "../messages/nl/auth.json";
import nlProjects from "../messages/nl/projects.json";
import nlSections from "../messages/nl/sections.json";
import nlWsPage from "../messages/nl/wsPage.json";
import nlWsChrome from "../messages/nl/wsChrome.json";
import nlTopbar from "../messages/nl/topbar.json";
import nlPanelsChat from "../messages/nl/panelsChat.json";
import nlPanelsProps from "../messages/nl/panelsProps.json";
import nlPanelsA from "../messages/nl/panelsA.json";
import nlPanelsB from "../messages/nl/panelsB.json";
import nlModalsAsset from "../messages/nl/modalsAsset.json";
import nlModalsDomain from "../messages/nl/modalsDomain.json";
import nlModalsDeploy from "../messages/nl/modalsDeploy.json";

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
  pt: {
    common: ptCommon,
    families: ptFamilies,
    marketing: ptMarketing,
    pages: ptPages,
    auth: ptAuth,
    projects: ptProjects,
    sections: ptSections,
    wsPage: ptWsPage,
    wsChrome: ptWsChrome,
    topbar: ptTopbar,
    panelsChat: ptPanelsChat,
    panelsProps: ptPanelsProps,
    panelsA: ptPanelsA,
    panelsB: ptPanelsB,
    modalsAsset: ptModalsAsset,
    modalsDomain: ptModalsDomain,
    modalsDeploy: ptModalsDeploy,
  },
  fr: {
    common: frCommon,
    families: frFamilies,
    marketing: frMarketing,
    pages: frPages,
    auth: frAuth,
    projects: frProjects,
    sections: frSections,
    wsPage: frWsPage,
    wsChrome: frWsChrome,
    topbar: frTopbar,
    panelsChat: frPanelsChat,
    panelsProps: frPanelsProps,
    panelsA: frPanelsA,
    panelsB: frPanelsB,
    modalsAsset: frModalsAsset,
    modalsDomain: frModalsDomain,
    modalsDeploy: frModalsDeploy,
  },
  de: {
    common: deCommon,
    families: deFamilies,
    marketing: deMarketing,
    pages: dePages,
    auth: deAuth,
    projects: deProjects,
    sections: deSections,
    wsPage: deWsPage,
    wsChrome: deWsChrome,
    topbar: deTopbar,
    panelsChat: dePanelsChat,
    panelsProps: dePanelsProps,
    panelsA: dePanelsA,
    panelsB: dePanelsB,
    modalsAsset: deModalsAsset,
    modalsDomain: deModalsDomain,
    modalsDeploy: deModalsDeploy,
  },
  it: {
    common: itCommon,
    families: itFamilies,
    marketing: itMarketing,
    pages: itPages,
    auth: itAuth,
    projects: itProjects,
    sections: itSections,
    wsPage: itWsPage,
    wsChrome: itWsChrome,
    topbar: itTopbar,
    panelsChat: itPanelsChat,
    panelsProps: itPanelsProps,
    panelsA: itPanelsA,
    panelsB: itPanelsB,
    modalsAsset: itModalsAsset,
    modalsDomain: itModalsDomain,
    modalsDeploy: itModalsDeploy,
  },
  ja: {
    common: jaCommon,
    families: jaFamilies,
    marketing: jaMarketing,
    pages: jaPages,
    auth: jaAuth,
    projects: jaProjects,
    sections: jaSections,
    wsPage: jaWsPage,
    wsChrome: jaWsChrome,
    topbar: jaTopbar,
    panelsChat: jaPanelsChat,
    panelsProps: jaPanelsProps,
    panelsA: jaPanelsA,
    panelsB: jaPanelsB,
    modalsAsset: jaModalsAsset,
    modalsDomain: jaModalsDomain,
    modalsDeploy: jaModalsDeploy,
  },
  ko: {
    common: koCommon,
    families: koFamilies,
    marketing: koMarketing,
    pages: koPages,
    auth: koAuth,
    projects: koProjects,
    sections: koSections,
    wsPage: koWsPage,
    wsChrome: koWsChrome,
    topbar: koTopbar,
    panelsChat: koPanelsChat,
    panelsProps: koPanelsProps,
    panelsA: koPanelsA,
    panelsB: koPanelsB,
    modalsAsset: koModalsAsset,
    modalsDomain: koModalsDomain,
    modalsDeploy: koModalsDeploy,
  },
  zh: {
    common: zhCommon,
    families: zhFamilies,
    marketing: zhMarketing,
    pages: zhPages,
    auth: zhAuth,
    projects: zhProjects,
    sections: zhSections,
    wsPage: zhWsPage,
    wsChrome: zhWsChrome,
    topbar: zhTopbar,
    panelsChat: zhPanelsChat,
    panelsProps: zhPanelsProps,
    panelsA: zhPanelsA,
    panelsB: zhPanelsB,
    modalsAsset: zhModalsAsset,
    modalsDomain: zhModalsDomain,
    modalsDeploy: zhModalsDeploy,
  },
  nl: {
    common: nlCommon,
    families: nlFamilies,
    marketing: nlMarketing,
    pages: nlPages,
    auth: nlAuth,
    projects: nlProjects,
    sections: nlSections,
    wsPage: nlWsPage,
    wsChrome: nlWsChrome,
    topbar: nlTopbar,
    panelsChat: nlPanelsChat,
    panelsProps: nlPanelsProps,
    panelsA: nlPanelsA,
    panelsB: nlPanelsB,
    modalsAsset: nlModalsAsset,
    modalsDomain: nlModalsDomain,
    modalsDeploy: nlModalsDeploy,
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
