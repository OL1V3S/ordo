import { useId, useState } from "react";
import { authApi } from "../../../shared/api/authApi";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const [isResending, setIsResending] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    if (mode === "register" && password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    try {
      if (mode === "register") {
        await authApi.register({ email, password });
        setMode("check-email");
        setConfirmationMessage(`A confirmation link was sent to ${email}.`);
        setResendMessage("");
        setPassword("");
        setConfirmPassword("");
        return;
      }

      const res = await authApi.login({ email, password });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("email", res.data.email);

      onLogin();
    } catch (err) {
      console.log("Auth error:", err.response?.data || err.message);

      const errorData = err.response?.data;

      if (errorData?.code === "confirmation_email_delivery_failed") {
        setMode("check-email");
        setConfirmationMessage(errorData.message);
        setPassword("");
        setConfirmPassword("");
        setResendMessage("");
        return;
      }

      if (Array.isArray(errorData)) {
        alert(errorData.map((e) => e.description).join("\n"));
      } else if (typeof errorData === "string") {
        alert(errorData);
      } else if (typeof errorData?.message === "string") {
        alert(errorData.message);
      } else {
        alert(err.message || "Something went wrong.");
      }
    }
  }

  async function handleResendConfirmation() {
    if (!email || isResending) return;

    setIsResending(true);
    setResendMessage("");

    try {
      const response = await authApi.resendConfirmation({ email });
      setResendMessage(response.data.message);
    } catch (err) {
      if (err.response?.status === 429) {
        setResendMessage("Too many requests. Please wait before trying again.");
      } else {
        setResendMessage("Unable to request another confirmation email right now.");
      }
    } finally {
      setIsResending(false);
    }
  }

  function switchMode() {
    setMode(mode === "login" ? "register" : "login");
    setConfirmationMessage("");
    setResendMessage("");
    setPassword("");
    setConfirmPassword("");
  }

  function returnToLogin() {
    setMode("login");
    setConfirmationMessage("");
    setResendMessage("");
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>ordo</h1>
        {mode === "check-email" ? (
          <>
            <h2 className="h2">Check your email</h2>
            <p className="auth-help">{confirmationMessage}</p>
            <p className="auth-help mt-2">
              Confirm <strong>{email}</strong> before logging in.
            </p>

            {resendMessage && <p className="auth-help mt-2">{resendMessage}</p>}

            <button
              type="button"
              className="mt-2"
              onClick={handleResendConfirmation}
              disabled={!email || isResending}
            >
              {isResending ? "Requesting..." : "Resend confirmation email"}
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={returnToLogin}
            >
              Back to login
            </button>
          </>
        ) : (
          <>
            <h2 className="h2">
              {mode === "login" ? "Log In" : "Create Account"}
            </h2>

            <form onSubmit={handleSubmit} className="auth-form">
          <label className="sr-only" htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

        <label className="sr-only" htmlFor={passwordId}>Password</label>
        <div className="password-field">
        <input
            id={passwordId}
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
        />
        <button
            type="button"
            className="password-toggle"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((prev) => !prev)}
        >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
        </div>

        {mode === "login" && (
            <button
            type="button"
            className="button-ghost"
            onClick={() => navigate("/forgot-password")}
            >
            Forgot password?
            </button>
        )}


          {mode === "register" && (
            <>
              <label className="sr-only" htmlFor={confirmPasswordId}>Confirm password</label>
              <div className="password-field">
                <input
                    id={confirmPasswordId}
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                />
                <button
                    type="button"
                    className="password-toggle"
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
               </div>

            <p className="auth-help">Password must include:</p>
            <ul className="auth-help">
            <li>At least 6 characters</li>
            <li>One uppercase letter</li>
            <li>One lowercase letter</li>
            <li>One number</li>
            <li>One special character</li>
            </ul>
            </>
          )}

          <button type="submit">
            {mode === "login" ? "Log In" : "Register"}
          </button>
            </form>

            <button
              className="button-ghost"
              onClick={switchMode}
            >
              {mode === "login"
                ? "Need an account? Register"
                : "Already have an account? Log in"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
