using BudgetPlanner.Models;

namespace BudgetPlanner.Services;

public enum ConfirmationEmailReason
{
    Registration,
    Resend
}

public interface IAccountConfirmationService
{
    Task SendConfirmationEmailAsync(
        ApplicationUser user,
        ConfirmationEmailReason reason,
        EmailLanguage language,
        CancellationToken cancellationToken = default);
}
