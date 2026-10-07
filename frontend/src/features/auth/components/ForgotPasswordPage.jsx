import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../../shared/api/authApi";
import { mapResendFailure } from "../authMessages";
import { useTranslation } from "react-i18next";
import AuthShell from "./AuthShell";

export default function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(null);
  const [messageTone, setMessageTone] = useState("info");
  const [resendMessage, setResendMessage] = useState(null);
  const [resendTone, setResendTone] = useState("info");
  const [isResending, setIsResending] = useState(false);
  const emailId = useId();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      await authApi.forgotPassword({ email });
      setMessageTone("info");
      setMessage({ key: "forgotPassword.sent" });
    } catch {
      setMessageTone("danger");
      setMessage({ key: "forgotPassword.failed" });
    }
  }

  async function handleResendConfirmation() {
    if (!email || isResending) return;

    setIsResending(true);
    setResendMessage(null);

    try {
      await authApi.resendConfirmation({ email });
      setResendTone("success");
      setResendMessage({ key: "resend.sent" });
    } catch (err) {
      setResendTone("danger");
      setResendMessage(mapResendFailure(err));
    } finally {
      setIsResending(false);
    }
  }

  return (
    <AuthShell
      title={t("forgotPassword.title")}
      description={t("forgotPassword.description")}
      focusKey="forgot-password"
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="auth-field">
          <label className="auth-field__label" htmlFor={emailId}>
            {t("fields.email")}
          </label>
          <input
            id={emailId}
            type="email"
            placeholder={t("fields.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="auth-primary-action">
          {t("forgotPassword.submit")}
        </button>
      </form>

      {message && (
        <p
          className={`auth-status auth-status--${messageTone}`}
          role={messageTone === "danger" ? "alert" : "status"}
        >
          {t(message.key)}
        </p>
      )}

      <section className="auth-secondary" aria-label={t("forgotPassword.recovery.label")}>
        <details className="auth-disclosure">
          <summary className="auth-disclosure__summary">
            {t("forgotPassword.recovery.summary")}
          </summary>
          <div className="auth-actions">
            <p className="auth-help">
              {t("forgotPassword.recovery.help")}
            </p>
            <button
              type="button"
              className="button-ghost auth-text-action"
              onClick={handleResendConfirmation}
              disabled={!email || isResending}
            >
              {isResending ? t("resend.requesting") : t("resend.action")}
            </button>
          </div>
        </details>
        {resendMessage && (
          <p
            className={`auth-status auth-status--${resendTone}`}
            role={resendTone === "danger" ? "alert" : "status"}
          >
            {t(resendMessage.key)}
          </p>
        )}
      </section>

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
