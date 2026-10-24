import { useTranslation } from "react-i18next";
import Card from "../shared/ui/Card.jsx";

export default function AppErrorFallback() {
  const { t } = useTranslation("common");
  return (
    <main className="app-error-boundary" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: "var(--space-4)" }}>
      <Card>
        <div role="alert">
          <h1>{t("errorBoundary.title")}</h1>
          <p>{t("errorBoundary.body")}</p>
        </div>
        <button type="button" className="button-ghost" onClick={() => window.location.reload()}>
          {t("errorBoundary.reload")}
        </button>
      </Card>
    </main>
  );
}
