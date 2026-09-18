import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import ThemeControl from "../shared/theme/ThemeControl";
import { APP_DESTINATIONS, getMobileDestination, MOBILE_DESTINATIONS } from "./navigation";

function NavigationLink({ destination, compact = false }) {
  const { t } = useTranslation("navigation");
  const Icon = destination.icon;
  const label = t(destination.labelKey);
  return (
    <NavLink
      to={destination.to}
      className={({ isActive }) => `app-nav__link${isActive ? " app-nav__link--active" : ""}`}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
    >
      {({ isActive }) => (
        <>
          <Icon size={20} aria-hidden="true" />
          <span>{label}</span>
          {isActive && <span className="sr-only">{t("aria.currentPage")}</span>}
        </>
      )}
    </NavLink>
  );
}

export default function AppShell({ email, onLogout }) {
  const { t: tCommon } = useTranslation("common");
  const { t: tNavigation } = useTranslation("navigation");
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const accountButtonRef = useRef(null);
  const mainRef = useRef(null);
  const primaryDestinations = APP_DESTINATIONS.filter((destination) =>
    !["/settings", "/investing"].includes(destination.to));
  const secondaryDestinations = ["/settings", "/investing"]
    .map((to) => APP_DESTINATIONS.find((destination) => destination.to === to));
  const settingsDestination = APP_DESTINATIONS.find((destination) => destination.to === "/settings");
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, "") || "/";
  const mobileDestination = getMobileDestination(pathname);
  const parentDestination = mobileDestination?.to !== path && mobileDestination?.paths.length > 1
    ? mobileDestination : null;
  const currentPageKey = APP_DESTINATIONS.find((destination) => destination.to === path)?.labelKey
    ?? mobileDestination?.labelKey;
  const currentPage = currentPageKey ? tNavigation(currentPageKey) : tNavigation("workspace");

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    // Keep the destination header visible below the sticky pagebar, even for short hubs.
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  useEffect(() => {
    if (!isAccountMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (!accountMenuRef.current?.contains(event.target)) setIsAccountMenuOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsAccountMenuOpen(false);
        accountButtonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{tCommon("shell.skipToMainContent")}</a>
      <aside className="app-sidebar">
        <span className="app-wordmark">ordo</span>
        <nav className="app-nav" aria-label={tNavigation("aria.primary")}>
          {primaryDestinations.map((destination) => (
            <NavigationLink key={destination.to} destination={destination} />
          ))}
        </nav>
        <div className="app-sidebar__utilities">
          <nav className="app-sidebar__secondary" aria-label={tNavigation("aria.secondary")}>
            {secondaryDestinations.map((destination) => (
              <NavigationLink key={destination.to} destination={destination} />
            ))}
          </nav>
          <span className="app-sidebar__identity">{email || tCommon("shell.signedIn")}</span>
          <button type="button" className="button-ghost app-sidebar__logout" onClick={onLogout}>
            <LogOut size={18} aria-hidden="true" />
            <span>{tCommon("shell.logout")}</span>
          </button>
        </div>
      </aside>

      <div className="app-shell__main">
        <header className="app-pagebar">
          <span className="app-pagebar__desktop-title">{currentPage}</span>
          <span className="app-wordmark app-wordmark--mobile">ordo</span>
          <div className="app-pagebar__actions">
            <ThemeControl />
            <div className="app-pagebar__settings">
              <NavigationLink destination={settingsDestination} compact />
            </div>
            <div className="mobile-account" ref={accountMenuRef}>
              <button
                type="button"
                className="button-ghost icon-button mobile-account__trigger"
                aria-label={tCommon("shell.accountMenu")}
                aria-expanded={isAccountMenuOpen}
                aria-controls="mobile-account-options"
                ref={accountButtonRef}
                onClick={() => setIsAccountMenuOpen((isOpen) => !isOpen)}
              >
                <UserRound size={19} aria-hidden="true" />
              </button>
              {isAccountMenuOpen && (
                <div className="mobile-account__menu" id="mobile-account-options" role="group" aria-label={tCommon("shell.accountOptions")}>
                  <p className="mobile-account__label">{tCommon("shell.signedInAs")}</p>
                  <p className="mobile-account__email">{email || tCommon("shell.signedIn")}</p>
                  <button type="button" className="button-ghost mobile-account__logout" onClick={onLogout}>
                    <LogOut size={18} aria-hidden="true" />
                    {tCommon("shell.logout")}
                  </button>
                </div>
              )}
            </div>
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

      <nav className="mobile-nav" aria-label={tNavigation("aria.mobile")}>
        {MOBILE_DESTINATIONS.map((destination) => {
          const Icon = destination.icon;
          const isActive = mobileDestination === destination;
          return (
            <Link
              key={destination.to}
              to={destination.to}
              className={`app-nav__link${isActive ? " app-nav__link--active" : ""}`}
              aria-current={isActive ? (path === destination.to ? "page" : "location") : undefined}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{tNavigation(destination.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
