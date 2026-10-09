import { useTranslation } from "react-i18next";
import ListRow from "../../shared/ui/ListRow";
import SectionHeader from "../../shared/ui/SectionHeader";
import "../../styles/secondary-pages.css";

const CAPABILITY_KEYS = ["connections", "portfolio", "signals", "activity"];

export default function InvestingPage() {
  const { t } = useTranslation("investing");
  return (
    <div className="shell-page investing-page">
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("description")}</p>
        </div>
      </header>

      <section className="investing-section investing-status" aria-labelledby="investing-status-heading">
        <p className="investing-status__label">{t("status.label")}</p>
        <SectionHeader level={2} id="investing-status-heading" title={t("status.title")} />
        <p className="muted investing-status__body">{t("status.body")}</p>
      </section>

      <section className="investing-section investing-capabilities" aria-labelledby="investing-capabilities-heading">
        <SectionHeader level={2} id="investing-capabilities-heading" title={t("capabilities.title")} />
        <ul className="investing-capabilities__list" aria-labelledby="investing-capabilities-heading">
          {CAPABILITY_KEYS.map((key) => (
            <ListRow
              key={key}
              titleAs="h3"
              label={t("capabilities.status")}
              title={t(`capabilities.${key}.title`)}
              meta={t(`capabilities.${key}.body`)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
