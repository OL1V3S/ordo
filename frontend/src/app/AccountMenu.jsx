import { useEffect, useRef, useState } from "react";
import { ChevronUp, LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import LanguageControl from "../shared/localization/LanguageControl";
import ThemeControl from "../shared/theme/ThemeControl";
import { ACCOUNT_DESTINATIONS, normalizePath } from "./navigation";

// Non-modal disclosure popover: no ARIA menu role and no focus trap. Escape, an outside
// pointerdown, or focus leaving the wrapper closes it.
export default function AccountMenu({ variant = "bar", email, onLogout, panelId }) {
  const { t: tCommon } = useTranslation("common");
  const { t: tNavigation } = useTranslation("navigation");
  const { t: tSettings } = useTranslation("settings");
  const { pathname } = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const isSidebar = variant === "sidebar";
  const identity = email || tCommon("shell.signedIn");

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) setIsOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleBlur(event) {
    const next = event.relatedTarget;
    if (next && !wrapperRef.current?.contains(next)) setIsOpen(false);
  }

  function handleLinkClick(destination) {
    setIsOpen(false);
    // The route effect moves focus to <main> on navigation; a same-path click has no
    // route change, so return focus to the trigger instead of an unmounted link.
    if (normalizePath(pathname) === destination.to) triggerRef.current?.focus();
  }

  return (
    <div className={`account-menu account-menu--${variant}`} ref={wrapperRef} onBlur={handleBlur}>
      <button
        type="button"
        className={isSidebar ? "button-ghost account-menu__trigger account-menu__trigger--sidebar" : "button-ghost icon-button account-menu__trigger"}
        aria-label={isSidebar ? undefined : tCommon("shell.accountMenu")}
        aria-expanded={isOpen}
        aria-controls={panelId}
        ref={triggerRef}
        onClick={() => setIsOpen((open) => !open)}
      >
        {isSidebar ? (
          <>
            <UserRound size={19} aria-hidden="true" />
            <span className="account-menu__text">
              <span className="account-menu__name">{tCommon("shell.account")}</span>
              <span className="account-menu__email">{identity}</span>
            </span>
            <ChevronUp size={16} aria-hidden="true" />
          </>
        ) : (
          <UserRound size={19} aria-hidden="true" />
        )}
      </button>
      {isOpen && (
        <div className="account-menu__panel" id={panelId} role="group" aria-label={tCommon("shell.accountOptions")}>
          <p className="account-menu__label">{tCommon("shell.signedInAs")}</p>
          <p className="account-menu__identity">{identity}</p>
          <ul className="account-menu__links">
            {ACCOUNT_DESTINATIONS.map((destination) => {
              const Icon = destination.icon;
              return (
                <li key={destination.to}>
                  <Link className="account-menu__link" to={destination.to} onClick={() => handleLinkClick(destination)}>
                    <Icon size={18} aria-hidden="true" />
                    <span>{tNavigation(destination.labelKey)}</span>
                    {destination.to === "/investing" && (
                      <span className="account-menu__tag">{tNavigation("hubs.more.unavailable")}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="account-menu__controls">
            <ThemeControl />
            <LanguageControl label={tSettings("language.title")} />
          </div>
          <button type="button" className="button-ghost account-menu__logout" onClick={onLogout}>
            <LogOut size={18} aria-hidden="true" />
            {tCommon("shell.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
