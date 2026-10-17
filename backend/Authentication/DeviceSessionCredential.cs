using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace BudgetPlanner.Authentication;

/// <summary>
/// Encodes the device-session credential as
/// <c>base64url(16-byte session id) "." base64url(32-byte secret)</c>.
/// The id only locates the row; the secret proves possession and only its
/// SHA-256 hash is ever stored.
/// </summary>
public static class DeviceSessionCredential
{
    public const int SecretLength = 32;
    public const int HashLength = 32;
    private const int IdLength = 16;
    private const int EncodedIdLength = 22;
    private const int EncodedSecretLength = 43;

    public static byte[] NewSecret() => RandomNumberGenerator.GetBytes(SecretLength);

    public static string Format(Guid sessionId, byte[] secret)
    {
        if (secret.Length != SecretLength)
            throw new ArgumentException("Secret must be 32 bytes.", nameof(secret));

        return WebEncoders.Base64UrlEncode(sessionId.ToByteArray())
            + "."
            + WebEncoders.Base64UrlEncode(secret);
    }

    public static bool TryParse(string? credential, out Guid sessionId, out byte[] secret)
    {
        sessionId = Guid.Empty;
        secret = [];

        if (credential is null || credential.Length != EncodedIdLength + 1 + EncodedSecretLength)
            return false;
        if (credential[EncodedIdLength] != '.')
            return false;

        var encodedId = credential[..EncodedIdLength];
        var encodedSecret = credential[(EncodedIdLength + 1)..];
        if (!TryDecodeCanonical(encodedId, IdLength, out var idBytes)
            || !TryDecodeCanonical(encodedSecret, SecretLength, out var secretBytes))
            return false;

        sessionId = new Guid(idBytes);
        secret = secretBytes;
        return true;
    }

    public static byte[] HashSecret(byte[] secret) => SHA256.HashData(secret);

    public static byte[] HashSecurityStamp(string? securityStamp) =>
        SHA256.HashData(Encoding.UTF8.GetBytes(securityStamp ?? ""));

    public static bool HashesEqual(byte[] left, byte[] right) =>
        left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);

    private static bool TryDecodeCanonical(string encoded, int expectedLength, out byte[] bytes)
    {
        bytes = [];
        try
        {
            var decoded = WebEncoders.Base64UrlDecode(encoded);
            if (decoded.Length != expectedLength
                || !string.Equals(WebEncoders.Base64UrlEncode(decoded), encoded, StringComparison.Ordinal))
                return false;

            bytes = decoded;
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
