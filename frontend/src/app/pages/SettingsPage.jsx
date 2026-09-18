import { useTranslation } from "react-i18next";
import LanguageControl from "../../shared/localization/LanguageControl";
import Card from "../../shared/ui/Card";
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
        <Card as="section" className="settings-page__appearance">
          <h2 className="h2">{t("appearance.title", { ns: "settings" })}</h2>
          <ThemeControl label={t("theme.preferenceLabel", { ns: "common" })} className="theme-control--settings" />
          <p className="muted settings-page__helper">{t("appearance.helper", { ns: "settings" })}</p>
        </Card>

        <Card as="section" className="settings-page__language">
          <h2 className="h2">{t("language.title", { ns: "settings" })}</h2>
          <LanguageControl className="language-control--settings" />
          <p className="muted settings-page__helper">{t("language.helper", { ns: "settings" })}</p>
        </Card>

        <section className="settings-page__account" aria-labelledby="settings-account-heading">
          <h2 className="h2" id="settings-account-heading">{t("account.title", { ns: "settings" })}</h2>
          <dl className="settings-page__account-row">
            <dt>{t("account.signedInEmail", { ns: "settings" })}</dt>
            <dd>{email}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
