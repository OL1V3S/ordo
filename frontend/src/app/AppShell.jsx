import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";
import AccountMenu from "./AccountMenu";
import { getPageLabelKey, getPrimaryDestination, normalizePath, PRIMARY_DESTINATIONS } from "./navigation";

function PrimaryLink({ destination, current }) {
  const { t } = useTranslation("navigation");
  const Icon = destination.icon;
  return (
    <Link
      to={destination.to}
      className={`app-nav__link${current ? " app-nav__link--active" : ""}`}
      aria-current={current || undefined}
    >
      <Icon size={20} aria-hidden="true" />
      <span>{t(destination.labelKey)}</span>
    </Link>
  );
}

export default function AppShell({ email, onLogout }) {
  const { t: tCommon } = useTranslation("common");
  const { t: tNavigation } = useTranslation("navigation");
  const mainRef = useRef(null);
  const { pathname } = useLocation();
  const path = normalizePath(pathname);
  const primaryDestination = getPrimaryDestination(pathname);
  const parentDestination = primaryDestination?.to !== path && primaryDestination?.paths.length > 1
    ? primaryDestination : null;
  const currentPageKey = getPageLabelKey(pathname);
  const currentPage = currentPageKey ? tNavigation(currentPageKey) : tNavigation("workspace");

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    // Keep the destination header visible below the sticky pagebar, even for short hubs.
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{tCommon("shell.skipToMainContent")}</a>
      <div className="app-sidebar">
        <span className="app-wordmark">ordo</span>
        <nav className="app-nav" aria-label={tNavigation("aria.primary")}>
          <ul className="app-nav__list">
            {PRIMARY_DESTINATIONS.map((destination) => {
              const isSelf = path === destination.to;
              const isGroupCurrent = primaryDestination === destination;
              return (
                <li key={destination.to}>
                  <PrimaryLink destination={destination} current={isSelf ? "page" : isGroupCurrent ? "location" : undefined} />
                  {destination.children && (
                    <ul className="app-nav__children">
                      {destination.children.map((child) => (
                        <li key={child.to}>
                          <PrimaryLink destination={child} current={path === child.to ? "page" : undefined} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="app-sidebar__account">
          <AccountMenu variant="sidebar" email={email} onLogout={onLogout} panelId="sidebar-account-options" />
        </div>
      </div>

      <div className="app-shell__main">
        <header className="app-pagebar">
          <span className="app-pagebar__desktop-title">{currentPage}</span>
          <span className="app-wordmark app-wordmark--mobile">ordo</span>
          <div className="app-pagebar__actions">
            <AccountMenu variant="bar" email={email} onLogout={onLogout} panelId="mobile-account-options" />
          </div>
        </header>
        <main className="app-content" id="main-content" tabIndex={-1} ref={mainRef}>
          {parentDestination && (
            <Link className="mobile-parent-link" to={parentDestination.to}>
              <ArrowLeft size={16} aria-hidden="true" />
              {tNavigation(parentDestination.labelKey)}
            </Link>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
