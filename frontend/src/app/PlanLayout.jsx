import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { normalizePath, PLAN_DEFAULT_PATH, PLAN_DESTINATIONS } from "./navigation";
import "../styles/plan-switcher.css";

export function PlanSwitcher() {
  const { t } = useTranslation("navigation");
  const path = normalizePath(useLocation().pathname);

  return (
    <nav className="plan-switcher" aria-label={t("hubs.plan.ariaLabel")}>
      <ul className="plan-switcher__list">
        {PLAN_DESTINATIONS.map(({ to, labelKey }) => {
          const current = path === to || (path === "/plan" && to === PLAN_DEFAULT_PATH);
          return (
            <li key={to}>
              <Link
                to={to}
                className={`plan-switcher__link${current ? " plan-switcher__link--current" : ""}`}
                aria-current={current ? "page" : undefined}
              >
                {t(labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Must stay a fragment: `.app-content > .container` needs the page container
// to remain a direct child of <main>.
export default function PlanLayout() {
  return (
    <>
      <PlanSwitcher />
      <Outlet />
    </>
  );
}
