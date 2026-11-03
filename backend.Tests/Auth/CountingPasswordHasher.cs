using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// Counts password verifies (#299, #319). A verify of the user's own stored hash is a
/// real check; any other hash is the sign-in timing equalizer's dummy hash.
/// </summary>
internal sealed class PasswordCheckCounter
{
    private int _real;
    private int _dummy;

    public int Value => Volatile.Read(ref _real);
    public int Dummy => Volatile.Read(ref _dummy);

    public void Record(bool real) => Interlocked.Increment(ref real ? ref _real : ref _dummy);

    public void Reset()
    {
        Interlocked.Exchange(ref _real, 0);
        Interlocked.Exchange(ref _dummy, 0);
    }
}

internal sealed class CountingPasswordHasher(IPasswordHasher<ApplicationUser> inner, PasswordCheckCounter counter)
    : IPasswordHasher<ApplicationUser>
{
    public string HashPassword(ApplicationUser user, string password) => inner.HashPassword(user, password);

    public PasswordVerificationResult VerifyHashedPassword(ApplicationUser user, string hashedPassword, string providedPassword)
    {
        counter.Record(real: user.PasswordHash == hashedPassword);
        return inner.VerifyHashedPassword(user, hashedPassword, providedPassword);
    }
}
