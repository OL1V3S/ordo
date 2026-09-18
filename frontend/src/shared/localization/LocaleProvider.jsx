import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { applyDocumentLocale } from "./locale";

export function LocaleProvider({ children, instance = i18n }) {
  useEffect(() => {
    function handleLanguageChanged(locale) {
      applyDocumentLocale(locale);
    }

    applyDocumentLocale(instance.resolvedLanguage ?? instance.language);
    instance.on("languageChanged", handleLanguageChanged);
    return () => instance.off("languageChanged", handleLanguageChanged);
  }, [instance]);

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}
