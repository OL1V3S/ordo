import { useId, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../../../shared/api/authApi";
import { useTranslation } from "react-i18next";
import AuthShell from "./AuthShell";
import PasswordField from "./PasswordField";

export default function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageTone, setMessageTone] = useState("info");
  const passwordId = useId();

  const email = searchParams.get("email");
  const token = searchParams.get("token");

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      await authApi.resetPassword({
        email,
        token,
        newPassword: password,
      });

      setMessageTone("success");
      setMessage({ key: "resetPassword.success" });
    } catch {
      setMessageTone("danger");
      setMessage({ key: "resetPassword.failed" });
    }
  }

  return (
    <AuthShell title={t("resetPassword.title")} focusKey="reset-password">
      <form onSubmit={handleSubmit} className="auth-form">
        <PasswordField
          id={passwordId}
          label={t("fields.newPassword")}
          placeholder={t("fields.newPasswordPlaceholder")}
          showLabel={t("passwordToggle.showNewPassword")}
          hideLabel={t("passwordToggle.hideNewPassword")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          isRevealed={showPassword}
          onToggle={() => setShowPassword((previous) => !previous)}
        />

        <button type="submit" className="auth-primary-action">
          {t("resetPassword.submit")}
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
