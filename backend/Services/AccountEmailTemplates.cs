namespace BudgetPlanner.Services;

public sealed record AccountEmailContent(string Subject, string HtmlBody);

/// <summary>
/// Fixed, closed set of account email copy. Request input only selects the
/// <see cref="EmailLanguage"/>; it never selects a template or key. Links are
/// encoded by the caller exactly as before localization.
/// </summary>
public static class AccountEmailTemplates
{
    public static AccountEmailContent ConfirmationEmail(EmailLanguage language, string htmlEncodedUrl)
    {
        var (subject, intro, button, footer) = language switch
        {
            EmailLanguage.Spanish => (
                "Confirma tu cuenta de Ordo",
                "Confirma tu correo para terminar de crear tu cuenta.",
                "Confirmar correo",
                "Si no creaste esta cuenta, puedes ignorar este correo sin problema."),
            _ => (
                "Confirm your Ordo account",
                "Confirm your email to finish creating your account.",
                "Confirm Email",
                "If you didn’t create this account, you can safely ignore this email.")
        };

        var body =
            $"""
            <div style="background:#0f172a; padding:40px 20px; font-family:Arial, sans-serif;">
              <div style="max-width:500px; margin:auto; background:#020617; border-radius:14px; padding:24px; border:1px solid #1f2933;">
                <h2 style="color:#e5e7eb; margin:0 0 10px;">Ordo</h2>
                <p style="color:rgba(255,255,255,0.7); margin:0 0 20px;">
                  {intro}
                </p>
                <a href="{htmlEncodedUrl}"
                   style="display:inline-block; padding:12px 20px; background:#2e6dd3; color:white; text-decoration:none; border-radius:12px; font-weight:600;">
                  {button}
                </a>
                <p style="color:rgba(255,255,255,0.5); margin-top:25px; font-size:13px;">
                  {footer}
                </p>
              </div>
            </div>
            """;

        return new AccountEmailContent(subject, body);
    }

    public static AccountEmailContent PasswordResetEmail(EmailLanguage language, string resetLink)
    {
        var (subject, intro, button, footer) = language switch
        {
            EmailLanguage.Spanish => (
                "Restablece tu contraseña de Ordo",
                "Restablece tu contraseña con el botón de abajo.",
                "Restablecer contraseña",
                "Si no solicitaste esto, puedes ignorar este correo."),
            _ => (
                "Reset your Ordo password",
                "Reset your password using the button below.",
                "Reset Password",
                "If you didn’t request this, you can ignore this email.")
        };

        var body =
            $"""
            <div style="background:#0f172a; padding:40px 20px; font-family:Arial, sans-serif;">
              <div style="max-width:500px; margin:auto; background:#020617; border-radius:14px; padding:24px; border:1px solid #1f2933;">

                <h2 style="color:#e5e7eb; margin:0 0 10px;">Ordo</h2>

                <p style="color:rgba(255,255,255,0.7); margin:0 0 20px;">
                  {intro}
                </p>

                <a href="{resetLink}"
                   style="display:inline-block; padding:12px 20px; background:#ef4444; color:white; text-decoration:none; border-radius:12px; font-weight:600;">
                  {button}
                </a>

                <p style="color:rgba(255,255,255,0.5); margin-top:25px; font-size:13px;">
                  {footer}
                </p>
              </div>
            </div>
            """;

        return new AccountEmailContent(subject, body);
    }

    /// <summary>
    /// Sent to the stored address when someone registers with an email that
    /// already has an account (#300). Plain links only: no token of any kind.
    /// One copy for confirmed and unconfirmed accounts.
    /// </summary>
    public static AccountEmailContent ExistingAccountEmail(
        EmailLanguage language,
        string htmlEncodedSignInUrl,
        string htmlEncodedForgotPasswordUrl)
    {
        var (subject, intro, action, signIn, reset, footer) = language switch
        {
            EmailLanguage.Spanish => (
                "Alguien intentó crear una cuenta de Ordo con tu correo",
                "Alguien intentó crear una cuenta nueva de Ordo con este correo. Ya tienes una cuenta, así que no cambiamos nada.",
                "Si fuiste tú, inicia sesión o restablece tu contraseña.",
                "Iniciar sesión",
                "Restablecer contraseña",
                "Si no fuiste tú, puedes ignorar este correo sin problema."),
            _ => (
                "Someone tried to create an Ordo account with your email",
                "Someone tried to create a new Ordo account with this email. You already have an account, so nothing was changed.",
                "If this was you, sign in or reset your password.",
                "Sign in",
                "Reset password",
                "If this wasn’t you, you can safely ignore this email.")
        };

        var body =
            $"""
            <div style="background:#0f172a; padding:40px 20px; font-family:Arial, sans-serif;">
              <div style="max-width:500px; margin:auto; background:#020617; border-radius:14px; padding:24px; border:1px solid #1f2933;">
                <h2 style="color:#e5e7eb; margin:0 0 10px;">Ordo</h2>
                <p style="color:rgba(255,255,255,0.7); margin:0 0 12px;">
                  {intro}
                </p>
                <p style="color:rgba(255,255,255,0.7); margin:0 0 20px;">
                  {action}
                </p>
                <p style="margin:0;">
                  <a href="{htmlEncodedSignInUrl}" style="color:#93c5fd;">{signIn}</a>
                  &nbsp;·&nbsp;
                  <a href="{htmlEncodedForgotPasswordUrl}" style="color:#93c5fd;">{reset}</a>
                </p>
                <p style="color:rgba(255,255,255,0.5); margin-top:25px; font-size:13px;">
                  {footer}
                </p>
              </div>
            </div>
            """;

        return new AccountEmailContent(subject, body);
    }
}
