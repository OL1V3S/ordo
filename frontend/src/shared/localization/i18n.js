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
import { applyDocumentLocale, getStoredLocale } from "./locale";

export const resources = {
  en: { common: commonEn, navigation: navigationEn, settings: settingsEn, home: homeEn },
  es: { common: commonEs, navigation: navigationEs, settings: settingsEs, home: homeEs },
};

const initialLocale = getStoredLocale();

export const i18n = createInstance();
i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: "en",
  supportedLngs: ["en", "es"],
  load: "languageOnly",
  ns: ["common", "navigation", "settings", "home"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  initAsync: false,
  react: { useSuspense: false },
});

applyDocumentLocale(initialLocale);

export default i18n;
