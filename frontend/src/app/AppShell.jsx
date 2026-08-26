import { useEffect, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import ThemeControl from "../shared/theme/ThemeControl";
import { APP_DESTINATIONS } from "./navigation";

function NavigationLink({ destination, compact = false }) {
  const Icon = destination.icon;
  return (
    <NavLink
      to={destination.to}
      className={({ isActive }) => `app-nav__link${isActive ? " app-nav__link--active" : ""}`}
      aria-label={compact ? destination.label : undefined}
      title={compact ? destination.label : undefined}
    >
      {({ isActive }) => (
        <>
          <Icon size={20} aria-hidden="true" />
          <span>{destination.label}</span>
          {isActive && <span className="sr-only">Current page</span>}
        </>
      )}
    </NavLink>
  );
}

export default function AppShell({ email, onLogout }) {
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const accountButtonRef = useRef(null);
  const primaryDestinations = APP_DESTINATIONS.filter((destination) => destination.to !== "/settings");
  const settingsDestination = APP_DESTINATIONS.find((destination) => destination.to === "/settings");
  const { pathname } = useLocation();
  const currentPage = APP_DESTINATIONS.find((destination) => destination.to === pathname)?.label ?? "Workspace";

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
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="app-sidebar">
        <span className="app-wordmark">ordo</span>
        <nav className="app-nav" aria-label="Primary navigation">
          {primaryDestinations.map((destination) => (
            <NavigationLink key={destination.to} destination={destination} />
          ))}
        </nav>
        <div className="app-sidebar__utilities">
          <div className="app-sidebar__settings">
            <NavigationLink destination={settingsDestination} />
          </div>
          <span className="app-sidebar__identity">{email || "Signed in"}</span>
          <button type="button" className="button-ghost app-sidebar__logout" onClick={onLogout}>
            <LogOut size={18} aria-hidden="true" />
            <span>Logout</span>
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
                aria-label="Account menu"
                aria-expanded={isAccountMenuOpen}
                aria-controls="mobile-account-options"
                ref={accountButtonRef}
                onClick={() => setIsAccountMenuOpen((isOpen) => !isOpen)}
              >
                <UserRound size={19} aria-hidden="true" />
              </button>
              {isAccountMenuOpen && (
                <div className="mobile-account__menu" id="mobile-account-options" role="group" aria-label="Account options">
                  <p className="mobile-account__label">Signed in as</p>
                  <p className="mobile-account__email">{email || "Signed in"}</p>
                  <button type="button" className="button-ghost mobile-account__logout" onClick={onLogout}>
                    <LogOut size={18} aria-hidden="true" />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="app-content" id="main-content">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {primaryDestinations.map((destination) => (
          <NavigationLink key={destination.to} destination={destination} compact />
        ))}
      </nav>
    </div>
  );
}
