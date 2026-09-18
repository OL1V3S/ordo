import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "./useTheme";

export default function ThemeControl({ label, className = "" }) {
  const { t } = useTranslation("common");
  const { theme, setTheme } = useTheme();
  const controlId = useId();
  const controlLabel = label ?? t("theme.label");

  return (
    <div className={`theme-control ${className}`.trim()}>
      <label htmlFor={controlId}>{controlLabel}</label>
      <select id={controlId} value={theme} onChange={(event) => setTheme(event.target.value)}>
        <option value="system">{t("theme.options.system")}</option>
        <option value="light">{t("theme.options.light")}</option>
        <option value="dark">{t("theme.options.dark")}</option>
      </select>
    </div>
  );
}
