namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// Exact English account-email output captured from main before localization.
/// <c>{LINK}</c> marks the href value. These prove English stays byte-identical.
/// </summary>
internal static class EnglishAccountEmailGolden
{
    public const string ConfirmationSubject = "Confirm your Ordo account";

    public const string ConfirmationBody = """
        <div style="background:#0f172a; padding:40px 20px; font-family:Arial, sans-serif;">
          <div style="max-width:500px; margin:auto; background:#020617; border-radius:14px; padding:24px; border:1px solid #1f2933;">
            <h2 style="color:#e5e7eb; margin:0 0 10px;">Ordo</h2>
            <p style="color:rgba(255,255,255,0.7); margin:0 0 20px;">
              Confirm your email to finish creating your account.
            </p>
            <a href="{LINK}"
               style="display:inline-block; padding:12px 20px; background:#2e6dd3; color:white; text-decoration:none; border-radius:12px; font-weight:600;">
              Confirm Email
            </a>
            <p style="color:rgba(255,255,255,0.5); margin-top:25px; font-size:13px;">
              If you didn’t create this account, you can safely ignore this email.
            </p>
          </div>
        </div>
        """;

    public const string ResetSubject = "Reset your Ordo password";

    public const string ResetBody = """
        <div style="background:#0f172a; padding:40px 20px; font-family:Arial, sans-serif;">
          <div style="max-width:500px; margin:auto; background:#020617; border-radius:14px; padding:24px; border:1px solid #1f2933;">

            <h2 style="color:#e5e7eb; margin:0 0 10px;">Ordo</h2>

            <p style="color:rgba(255,255,255,0.7); margin:0 0 20px;">
              Reset your password using the button below.
            </p>

            <a href="{LINK}"
               style="display:inline-block; padding:12px 20px; background:#ef4444; color:white; text-decoration:none; border-radius:12px; font-weight:600;">
              Reset Password
            </a>

            <p style="color:rgba(255,255,255,0.5); margin-top:25px; font-size:13px;">
              If you didn’t request this, you can ignore this email.
            </p>
          </div>
        </div>
        """;
}
