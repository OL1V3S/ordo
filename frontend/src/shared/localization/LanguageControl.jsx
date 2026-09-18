import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "./useLocale";

export default function LanguageControl({ className = "" }) {
  const { t } = useTranslation("settings");
  const { locale, setLocale } = useLocale();
  const controlId = useId();

  return (
    <div className={`language-control ${className}`.trim()}>
      <label htmlFor={controlId}>{t("language.label")}</label>
      <select id={controlId} value={locale} onChange={(event) => setLocale(event.target.value)}>
        <option value="en">{t("language.options.en")}</option>
        <option value="es">{t("language.options.es")}</option>
      </select>
    </div>
  );
}
