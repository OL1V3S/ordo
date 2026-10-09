import { useTranslation } from "react-i18next";
import LanguageControl from "../../shared/localization/LanguageControl";
import SectionHeader from "../../shared/ui/SectionHeader";
import ThemeControl from "../../shared/theme/ThemeControl";
import "../../styles/secondary-pages.css";

export default function SettingsPage({ email }) {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <div className="shell-page secondary-page settings-page">
      <header className="page-header">
        <div>
          <h1>{t("title", { ns: "settings" })}</h1>
          <p className="muted">{t("description", { ns: "settings" })}</p>
        </div>
      </header>

      <div className="settings-page__content">
        <section className="settings-section settings-page__appearance" aria-labelledby="settings-appearance-heading">
          <SectionHeader level={2} id="settings-appearance-heading" title={t("appearance.title", { ns: "settings" })} />
          <ThemeControl label={t("theme.preferenceLabel", { ns: "common" })} className="theme-control--settings" />
          <p className="muted settings-page__helper">{t("appearance.helper", { ns: "settings" })}</p>
        </section>

        <section className="settings-section settings-page__language" aria-labelledby="settings-language-heading">
          <SectionHeader level={2} id="settings-language-heading" title={t("language.title", { ns: "settings" })} />
          <LanguageControl className="language-control--settings" />
          <p className="muted settings-page__helper">{t("language.helper", { ns: "settings" })}</p>
        </section>

        <section className="settings-section settings-page__account" aria-labelledby="settings-account-heading">
          <SectionHeader level={2} id="settings-account-heading" title={t("account.title", { ns: "settings" })} />
          <dl className="settings-page__account-row">
            <dt>{t("account.signedInEmail", { ns: "settings" })}</dt>
            <dd>{email}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
