using System.Security.Cryptography;
using System.Text;
using BudgetPlanner.Authentication;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

public sealed class DeviceSessionCredentialTests
{
    [Fact]
    public void Credential_round_trips_the_session_id_and_secret()
    {
        var id = Guid.NewGuid();
        var secret = DeviceSessionCredential.NewSecret();

        var credential = DeviceSessionCredential.Format(id, secret);

        Assert.True(DeviceSessionCredential.TryParse(credential, out var parsedId, out var parsedSecret));
        Assert.Equal(id, parsedId);
        Assert.Equal(secret, parsedSecret);
    }

    [Fact]
    public void Credential_has_the_documented_shape_and_url_safe_alphabet()
    {
        var credential = DeviceSessionCredential.Format(
            Guid.NewGuid(), DeviceSessionCredential.NewSecret());

        var parts = credential.Split('.');
        Assert.Equal(2, parts.Length);
        Assert.Equal(22, parts[0].Length);
        Assert.Equal(43, parts[1].Length);
        Assert.Equal(66, credential.Length);
        Assert.All(credential.Replace(".", ""), character =>
            Assert.True(char.IsAsciiLetterOrDigit(character) || character is '-' or '_'));
    }

    [Fact]
    public void Each_new_secret_is_different()
    {
        Assert.NotEqual(DeviceSessionCredential.NewSecret(), DeviceSessionCredential.NewSecret());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(".")]
    [InlineData("a.b")]
    [InlineData("not a credential")]
    public void Obviously_malformed_input_is_rejected(string? credential)
    {
        Assert.False(DeviceSessionCredential.TryParse(credential, out var id, out var secret));
        Assert.Equal(Guid.Empty, id);
        Assert.Empty(secret);
    }

    [Fact]
    public void Wrong_lengths_bad_alphabet_and_extra_separators_are_rejected()
    {
        var good = DeviceSessionCredential.Format(Guid.NewGuid(), DeviceSessionCredential.NewSecret());
        var parts = good.Split('.');

        Assert.False(DeviceSessionCredential.TryParse(good + "A", out _, out _));
        Assert.False(DeviceSessionCredential.TryParse(good[..^1], out _, out _));
        Assert.False(DeviceSessionCredential.TryParse(parts[0] + "!" + parts[1], out _, out _));
        Assert.False(DeviceSessionCredential.TryParse(parts[0] + ":" + parts[1], out _, out _));
        Assert.False(DeviceSessionCredential.TryParse(parts[1] + "." + parts[0], out _, out _));
        Assert.False(DeviceSessionCredential.TryParse(
            parts[0] + "." + parts[1][..^1] + "+", out _, out _));
        Assert.False(DeviceSessionCredential.TryParse(
            parts[0] + "." + parts[1][..^1] + "=", out _, out _));
        Assert.False(DeviceSessionCredential.TryParse(new string('A', 66), out _, out _));
        Assert.False(DeviceSessionCredential.TryParse(new string('A', 5000), out _, out _));
    }

    [Fact]
    public void Non_canonical_encodings_of_the_same_bytes_are_rejected()
    {
        const string alphabet =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        var good = DeviceSessionCredential.Format(Guid.NewGuid(), DeviceSessionCredential.NewSecret());
        // The last character of the 43-character secret carries two unused bits, so the
        // three siblings below decode to the same 32 bytes as the canonical form.
        var index = alphabet.IndexOf(good[^1]);
        var siblings = alphabet.Substring(index & ~3, 4).Where(candidate => candidate != good[^1]);

        Assert.True(DeviceSessionCredential.TryParse(good, out _, out _));
        foreach (var sibling in siblings)
            Assert.False(DeviceSessionCredential.TryParse(good[..^1] + sibling, out _, out _));
    }

    [Fact]
    public void Hashes_are_fixed_length_and_compare_by_value()
    {
        var secret = DeviceSessionCredential.NewSecret();

        var first = DeviceSessionCredential.HashSecret(secret);
        var second = DeviceSessionCredential.HashSecret(secret);

        Assert.Equal(32, first.Length);
        Assert.Equal(SHA256.HashData(secret), first);
        Assert.True(DeviceSessionCredential.HashesEqual(first, second));
        Assert.False(DeviceSessionCredential.HashesEqual(
            first, DeviceSessionCredential.HashSecret(DeviceSessionCredential.NewSecret())));
        Assert.False(DeviceSessionCredential.HashesEqual(first, first[..16]));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("a-security-stamp")]
    public void Security_stamp_hashes_are_fixed_length(string? stamp)
    {
        var hash = DeviceSessionCredential.HashSecurityStamp(stamp);

        Assert.Equal(32, hash.Length);
        Assert.Equal(SHA256.HashData(Encoding.UTF8.GetBytes(stamp ?? "")), hash);
    }

    [Fact]
    public void Format_rejects_a_secret_of_the_wrong_length()
    {
        Assert.Throws<ArgumentException>(() => DeviceSessionCredential.Format(Guid.NewGuid(), new byte[31]));
    }
}
