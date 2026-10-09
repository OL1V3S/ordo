import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../../../shared/api/authApi";
import StatusMessage from "../../../shared/ui/StatusMessage";
import { useTranslation } from "react-i18next";
import AuthShell from "./AuthShell";

const confirmationTones = {
  loading: "info",
  success: "success",
  error: "danger",
};

export default function ConfirmEmailPage() {
  const { t } = useTranslation("auth");
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("loading");
  const hasRun = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const userId = searchParams.get("userId");
    const token = searchParams.get("token");

    async function confirm() {
      try {
        await authApi.confirmEmail({ userId, token });
        setStatus("success");
      } catch {
        setStatus("error");
      }
    }

    if (userId && token) confirm();
    else setStatus("error");
  }, [searchParams]);

  const tone = confirmationTones[status];

  return (
    <AuthShell title={t(`confirmEmail.${status}.title`)} focusKey={status}>
      <StatusMessage tone={tone} aria-live={tone === "danger" ? "assertive" : "polite"}>
        {t(`confirmEmail.${status}.message`)}
      </StatusMessage>

      <div className="auth-actions auth-actions--secondary">
        <button
          type="button"
          className="button-ghost auth-text-action"
          onClick={() => navigate("/")}
        >
          {t("actions.backToLogin")}
        </button>
      </div>
    </AuthShell>
  );
}
