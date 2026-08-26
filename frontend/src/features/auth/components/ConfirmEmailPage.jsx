import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../../../shared/api/authApi";

export default function ConfirmEmailPage() {
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>ordo</h1>

        {status === "loading" && (
          <>
            <h2 className="h2">Confirming Email</h2>
            <p className="auth-help">Please wait...</p>
          </>
        )}

        {status === "success" && (
          <>
            <h2 className="h2">Email Confirmed</h2>
            <p className="auth-help">You can now log in.</p>
          </>
        )}

        {status === "error" && (
          <>
            <h2 className="h2">Unable to Confirm Email</h2>
            <p className="auth-help">
              This confirmation link is invalid, expired, or already used. Try
              logging in or request a new confirmation email.
            </p>
          </>
        )}

        <button
          type="button"
          className="button-ghost mt-2"
          onClick={() => navigate("/")}
        >
          Back to login
        </button>
      </div>
    </div>
  );
}
