import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MORE_DESTINATIONS } from "../navigation";
import "../../styles/secondary-pages.css";

export default function MorePage() {
  const { t } = useTranslation("navigation");
  return (
    <div className="shell-page secondary-page">
      <header className="page-header">
        <div>
          <h1>{t("hubs.more.title")}</h1>
          <p className="muted">{t("hubs.more.description")}</p>
        </div>
      </header>

      <nav aria-label={t("hubs.more.ariaLabel")}>
        <ul className="secondary-links secondary-links--more">
        {MORE_DESTINATIONS.map((destination) => {
          const { to, labelKey, icon: Icon, descriptionKey } = destination;
          const unavailable = to === "/investing";
          return (
            <li className={unavailable ? "secondary-links__subordinate" : ""} key={to}>
              <Link className="secondary-link" to={to}>
                <Icon className="secondary-link__icon" size={20} aria-hidden="true" />
                <span className="secondary-link__body">
                  <span className="secondary-link__title-row">
                    <span className="secondary-link__label">{t(labelKey)}</span>
                    {unavailable && <span className="secondary-link__status">{t("hubs.more.unavailable")}</span>}
                  </span>
                  <span className="secondary-link__description">{t(descriptionKey)}</span>
                </span>
              </Link>
            </li>
          );
        })}
        </ul>
      </nav>
    </div>
  );
}
