using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace BudgetPlanner.Authentication;

/// <summary>
/// The JWT signing keys, read once at startup (#338).
/// <c>Jwt:Key</c> is the current key: it signs and validates.
/// <c>Jwt:PreviousKey</c> is optional and validates only, so tokens signed before a
/// key swap keep working until they expire. Both are raw UTF-8 bytes (no trim, no base64).
/// With no previous key the validation parameters are exactly what they were before #338.
/// Messages name configuration keys only, never values.
/// </summary>
public sealed class JwtSigningKeys
{
    public const string CurrentKeyName = "Jwt:Key";
    public const string PreviousKeyName = "Jwt:PreviousKey";

    /// <summary>HS256 needs a 256-bit key.</summary>
    public const int MinimumKeyBytes = 32;

    private JwtSigningKeys(byte[] current, byte[]? previous)
    {
        Current = current;
        Previous = previous;
    }

    public byte[] Current { get; }

    /// <summary>Null when no previous key is configured.</summary>
    public byte[]? Previous { get; }

    public static JwtSigningKeys Read(IConfiguration configuration) =>
        Read(configuration[CurrentKeyName], configuration[PreviousKeyName]);

    public static JwtSigningKeys Read(string? currentKey, string? previousKey)
    {
        if (string.IsNullOrWhiteSpace(currentKey))
        {
            throw new InvalidOperationException("JWT key is missing");
        }

        var current = Encoding.UTF8.GetBytes(currentKey);

        // Empty or whitespace means "not configured": the unchanged single-key path.
        if (string.IsNullOrWhiteSpace(previousKey))
        {
            return new JwtSigningKeys(current, previous: null);
        }

        var previous = Encoding.UTF8.GetBytes(previousKey);

        if (previous.Length < MinimumKeyBytes)
        {
            throw new InvalidOperationException(
                $"{PreviousKeyName} must be at least {MinimumKeyBytes} bytes when set. Remove it or set a longer key.");
        }

        if (current.Length < MinimumKeyBytes)
        {
            throw new InvalidOperationException(
                $"{CurrentKeyName} must be at least {MinimumKeyBytes} bytes when {PreviousKeyName} is set.");
        }

        if (current.AsSpan().SequenceEqual(previous))
        {
            throw new InvalidOperationException(
                $"{PreviousKeyName} must differ from {CurrentKeyName}.");
        }

        return new JwtSigningKeys(current, previous);
    }

    /// <summary>
    /// Sets the signing keys used to validate tokens. The current key is always
    /// <c>IssuerSigningKey</c>; <c>IssuerSigningKeys</c> is touched only when a previous key exists.
    /// Tokens carry no <c>kid</c>, so the handler tries every configured key.
    /// </summary>
    public void ApplyTo(TokenValidationParameters parameters)
    {
        parameters.IssuerSigningKey = new SymmetricSecurityKey(Current);

        if (Previous is not null)
        {
            parameters.IssuerSigningKeys = new SecurityKey[] { new SymmetricSecurityKey(Previous) };
        }
    }
}
