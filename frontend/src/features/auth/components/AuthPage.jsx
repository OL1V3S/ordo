import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { authApi } from "../../../shared/api/authApi";
import { establishSession } from "../../../shared/auth/session";
import StatusMessage from "../../../shared/ui/StatusMessage";
import AuthShell from "./AuthShell";
import PasswordField from "./PasswordField";
import { mapResendFailure, mapSubmitError, translateDescriptors } from "../authMessages";

export default function AuthPage({ onLogin }) {
  const { t } = useTranslation("auth");
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState(null);
  const [resendMessage, setResendMessage] = useState(null);
  const [resendTone, setResendTone] = useState("info");
  const [formError, setFormError] = useState(null);
  const [isResending, setIsResending] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();
  const passwordRequirementsId = useId();
  const formErrorRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    if (mode === "register" && password !== confirmPassword) {
      setFormError([{ key: "register.passwordMismatch" }]);
      return;
    }

    try {
      if (mode === "register") {
        await authApi.register({ email, password });
        setMode("check-email");
        setConfirmationMessage({ key: "checkEmail.sent", values: { email } });
        setResendMessage(null);
        setPassword("");
        setConfirmPassword("");
        return;
      }

      const res = await authApi.login({ email, password });

      establishSession(res.data.token, res.data.email);

      onLogin?.();
    } catch (err) {
      console.log("Auth error:", err.response?.data || err.message);

      const mapped = mapSubmitError(err, { mode, email });

      if (mapped.kind === "deliveryFailed") {
        setMode("check-email");
        setConfirmationMessage(mapped.message);
        setPassword("");
        setConfirmPassword("");
        setResendMessage(null);
        return;
      }

      setFormError(mapped.messages);
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

  function switchMode() {
    setMode(mode === "login" ? "register" : "login");
    setConfirmationMessage(null);
    setResendMessage(null);
    setFormError(null);
    setPassword("");
    setConfirmPassword("");
  }

  function returnToLogin() {
    setMode("login");
    setConfirmationMessage(null);
    setResendMessage(null);
    setFormError(null);
  }

  if (mode === "check-email") {
    return (
      <AuthShell title={t("checkEmail.title")} focusKey="check-email">
        <StatusMessage tone="info">
          {confirmationMessage && t(confirmationMessage.key, confirmationMessage.values)}
        </StatusMessage>
        <p className="auth-help">
          <Trans
            t={t}
            i18nKey="checkEmail.confirmBefore"
            values={{ email }}
            components={{ strong: <strong /> }}
          />
        </p>
        {resendMessage && (
          <StatusMessage tone={resendTone}>
            {t(resendMessage.key)}
          </StatusMessage>
        )}
        <div className="auth-actions">
          <button
            type="button"
            className="auth-primary-action"
            onClick={handleResendConfirmation}
            disabled={!email || isResending}
          >
            {isResending ? t("resend.requesting") : t("resend.action")}
          </button>
          <button
            type="button"
            className="button-ghost auth-text-action"
            onClick={returnToLogin}
          >
            {t("actions.backToLogin")}
          </button>
        </div>
      </AuthShell>
    );
  }

  const isLogin = mode === "login";

  return (
    <AuthShell title={isLogin ? t("login.title") : t("register.title")} focusKey={mode}>
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

        <PasswordField
          id={passwordId}
          label={t("fields.password")}
          placeholder={t("fields.passwordPlaceholder")}
          showLabel={t("passwordToggle.showPassword")}
          hideLabel={t("passwordToggle.hidePassword")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          isRevealed={showPassword}
          onToggle={() => setShowPassword((previous) => !previous)}
          describedBy={isLogin ? undefined : passwordRequirementsId}
        />

        {isLogin && (
          <button
            type="button"
            className="button-ghost auth-text-action"
            onClick={() => navigate("/forgot-password")}
          >
            {t("login.forgotPassword")}
          </button>
        )}

        {!isLogin && (
          <>
            <PasswordField
              id={confirmPasswordId}
              label={t("fields.confirmPassword")}
              placeholder={t("fields.confirmPasswordPlaceholder")}
              showLabel={t("passwordToggle.showConfirmPassword")}
              hideLabel={t("passwordToggle.hideConfirmPassword")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              isRevealed={showConfirmPassword}
              onToggle={() => setShowConfirmPassword((previous) => !previous)}
            />

            <div
              id={passwordRequirementsId}
              className="auth-password-requirements auth-help"
            >
              <p>{t("register.requirements.title")}</p>
              <ul>
                <li>{t("register.requirements.length")}</li>
                <li>{t("register.requirements.upper")}</li>
                <li>{t("register.requirements.lower")}</li>
                <li>{t("register.requirements.digit")}</li>
                <li>{t("register.requirements.special")}</li>
              </ul>
            </div>
          </>
        )}

        {formError && (
          <StatusMessage ref={formErrorRef} tone="danger" tabIndex="-1">
            {translateDescriptors(t, formError)}
          </StatusMessage>
        )}

        <button type="submit" className="auth-primary-action">
          {isLogin ? t("login.submit") : t("register.submit")}
        </button>
      </form>

      <div className="auth-actions auth-actions--secondary">
        <button
          type="button"
          className="button-ghost auth-text-action"
          onClick={switchMode}
        >
          {isLogin ? t("login.switchToRegister") : t("register.switchToLogin")}
        </button>
      </div>
    </AuthShell>
  );
}
