import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PLAN_DESTINATIONS } from "../navigation";
import "../../styles/secondary-pages.css";

export default function PlanPage() {
  const { t } = useTranslation("navigation");
  return (
    <div className="shell-page secondary-page">
      <header className="page-header">
        <div>
          <h1>{t("hubs.plan.title")}</h1>
          <p className="muted">{t("hubs.plan.description")}</p>
        </div>
      </header>

      <nav aria-label={t("hubs.plan.ariaLabel")}>
        <ul className="secondary-links secondary-links--plan">
        {PLAN_DESTINATIONS.map((destination) => {
          const { to, labelKey, icon: Icon } = destination;
          return (
            <li key={to}>
              <Link className="secondary-link" to={to}>
                <Icon className="secondary-link__icon" size={20} aria-hidden="true" />
                <span className="secondary-link__label">{t(labelKey)}</span>
              </Link>
            </li>
          );
        })}
        </ul>
      </nav>
    </div>
  );
}
