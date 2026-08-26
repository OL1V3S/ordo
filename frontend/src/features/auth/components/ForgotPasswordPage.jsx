import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../../shared/api/authApi";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const [isResending, setIsResending] = useState(false);
  const emailId = useId();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      const res = await authApi.forgotPassword({ email });
      setMessage(res.data.message);
    } catch {
      setMessage("Something went wrong.");
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>ordo</h1>
        <h2 className="h2">Forgot Password</h2>

        <p className="auth-help">
          Enter your email and we’ll send you a reset link.
        </p>

        <form onSubmit={handleSubmit} className="auth-form mt-2">
          <label className="sr-only" htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <button type="submit">Send Reset Link</button>
        </form>

        {message && <p className="auth-help">{message}</p>}

        <section className="auth-secondary">
          <p className="auth-help">Didn't receive your account confirmation?</p>
          <button
            type="button"
            className="button-ghost"
            onClick={handleResendConfirmation}
            disabled={!email || isResending}
          >
            {isResending ? "Requesting..." : "Resend confirmation email"}
          </button>
          {resendMessage && <p className="auth-help">{resendMessage}</p>}
        </section>

        <button
          type="button"
          className="button-ghost"
          onClick={() => navigate("/")}
        >
          Back to login
        </button>
      </div>
    </div>
  );
}
