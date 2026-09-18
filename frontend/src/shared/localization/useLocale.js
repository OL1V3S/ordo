import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { applyDocumentLocale, isSupportedLocale, normalizeLocale, persistLocale } from "./locale";

export function useLocale() {
  const { i18n } = useTranslation();
  const locale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language);

  const setLocale = useCallback((nextLocale) => {
    if (!isSupportedLocale(nextLocale)) return;

    void i18n.changeLanguage(nextLocale);
    applyDocumentLocale(nextLocale);
    persistLocale(nextLocale);
  }, [i18n]);

  return { locale, setLocale };
}
