using System.Security.Cryptography;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;

namespace BudgetPlanner.Authentication;

/// <summary>
/// Hides account state from sign-in timing (#319). Sign-in paths that reject without
/// checking a real hash (unknown email, locked account) verify this dummy hash instead,
/// so they cost about the same as a wrong password. The dummy hash is built once at
/// startup from the registered hasher, so it has the configured cost. It is unrelated
/// to any account: the stored hash of a locked account is never checked.
/// </summary>
public sealed class PasswordTimingEqualizer
{
    private const string ProbePassword = "timing-equalizer-probe";

    private readonly string _dummyHash;

    private PasswordTimingEqualizer(string dummyHash) => _dummyHash = dummyHash;

    /// <summary>
    /// Builds the dummy hash inside its own scope: the password hasher is scoped, so it
    /// cannot be injected into this singleton.
    /// </summary>
    public static PasswordTimingEqualizer Create(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<ApplicationUser>>();
        var secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        return new PasswordTimingEqualizer(hasher.HashPassword(new ApplicationUser(), secret));
    }

    /// <summary>
    /// Runs one verify of the dummy hash through the request's own hasher. The result
    /// is discarded. Reads no account data and writes nothing.
    /// </summary>
    public void Equalize(IPasswordHasher<ApplicationUser> hasher) =>
        _ = hasher.VerifyHashedPassword(new ApplicationUser(), _dummyHash, ProbePassword);
}
