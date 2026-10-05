import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import commonEn from "./locales/en/common.json";
import navigationEn from "./locales/en/navigation.json";
import settingsEn from "./locales/en/settings.json";
import commonEs from "./locales/es/common.json";
import navigationEs from "./locales/es/navigation.json";
import settingsEs from "./locales/es/settings.json";
import homeEn from "./locales/en/home.json";
import homeEs from "./locales/es/home.json";
import activityEn from "./locales/en/activity.json";
import activityEs from "./locales/es/activity.json";
import importPreviewEn from "./locales/en/importPreview.json";
import importPreviewEs from "./locales/es/importPreview.json";
import paychecksEn from "./locales/en/paychecks.json";
import paychecksEs from "./locales/es/paychecks.json";
import budgetsEn from "./locales/en/budgets.json";
import budgetsEs from "./locales/es/budgets.json";
import analyticsEn from "./locales/en/analytics.json";
import analyticsEs from "./locales/es/analytics.json";
import commitmentsEn from "./locales/en/commitments.json";
import commitmentsEs from "./locales/es/commitments.json";
import { applyDocumentLocale, getStoredLocale } from "./locale";

export const resources = {
  en: { common: commonEn, navigation: navigationEn, settings: settingsEn, home: homeEn, activity: activityEn, importPreview: importPreviewEn, paychecks: paychecksEn, budgets: budgetsEn, analytics: analyticsEn, commitments: commitmentsEn },
  es: { common: commonEs, navigation: navigationEs, settings: settingsEs, home: homeEs, activity: activityEs, importPreview: importPreviewEs, paychecks: paychecksEs, budgets: budgetsEs, analytics: analyticsEs, commitments: commitmentsEs },
};

const initialLocale = getStoredLocale();

export const i18n = createInstance();
i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: "en",
  supportedLngs: ["en", "es"],
  load: "languageOnly",
  ns: ["common", "navigation", "settings", "home", "activity", "importPreview", "paychecks", "budgets", "analytics", "commitments"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  initAsync: false,
  react: { useSuspense: false },
});

applyDocumentLocale(initialLocale);

export default i18n;
