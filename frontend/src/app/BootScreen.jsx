import { useTranslation } from "react-i18next";

// Shown instead of sign-in while the page-load refresh may still restore a
// session (#337). The access token is memory-only, so every load waits for it.
export default function BootScreen({ status }) {
  const { t } = useTranslation("auth");

  return (
    <div className="auth-page">
      <main className="auth-card" aria-busy="true">
        <p className="auth-shell__brand">ordo</p>
        <div role="status" aria-live="polite">
          <p className="auth-help">{t("boot.loading")}</p>
          {status.slow && <p className="auth-help">{t("boot.slow")}</p>}
          {status.unreachable && <p className="auth-help">{t("boot.unreachable")}</p>}
        </div>
      </main>
    </div>
  );
}
