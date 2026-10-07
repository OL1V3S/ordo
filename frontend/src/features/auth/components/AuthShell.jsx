import { useEffect, useId, useRef } from "react";
import LanguageControl from "../../../shared/localization/LanguageControl";

export default function AuthShell({ title, description, focusKey = title, children }) {
  const titleId = useId();
  const titleRef = useRef(null);

  // Focus the heading when the view changes (focusKey), not when the language
  // changes the translated title.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [focusKey]);

  return (
    <div className="auth-page">
      <main className="auth-card" aria-labelledby={titleId}>
        <p className="auth-shell__brand">ordo</p>
        <LanguageControl />
        <header className="auth-shell__header">
          <h1 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h1>
          {description && <p className="auth-help">{description}</p>}
        </header>
        <div className="auth-shell__content">{children}</div>
      </main>
    </div>
  );
}
