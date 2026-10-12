export const LOCALE_STORAGE_KEY = "ordo-language";
export const SUPPORTED_LOCALES = ["en", "es"];
export const DEFAULT_LOCALE = "en";

// BCP 47 tags used for Intl formatting. This is the only place the regional tags are named.
export const FORMAT_TAGS = { en: "en-US", es: "es-MX" };

export function isSupportedLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale);
}

export function normalizeLocale(locale) {
  const language = typeof locale === "string" ? locale.split("-")[0] : "";
  return isSupportedLocale(language) ? language : DEFAULT_LOCALE;
}

export function getStoredLocale(storage = localStorage) {
  try {
    return normalizeLocale(storage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function persistLocale(locale, storage = localStorage) {
  if (!isSupportedLocale(locale)) return false;

  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Persistence is best-effort; the selected language still applies in memory.
  }
  return true;
}

export function applyDocumentLocale(locale, root = document.documentElement) {
  root.lang = normalizeLocale(locale);
}
