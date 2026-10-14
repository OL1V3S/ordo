using System.Text.Json;
using System.Text.Json.Serialization;

namespace BudgetPlanner.Services;

/// <summary>
/// Languages supported for server-sent account emails.
/// </summary>
public enum EmailLanguage
{
    English,
    Spanish
}

public static class EmailLanguageParser
{
    /// <summary>
    /// Maps a client-supplied language value to a supported email language.
    /// Only exactly "en" or "es" (case-insensitive, trimmed) are recognized;
    /// everything else falls back to English. Never throws and never echoes
    /// the value.
    /// </summary>
    public static EmailLanguage Parse(string? value)
    {
        var trimmed = value?.Trim();

        return string.Equals(trimmed, "es", StringComparison.OrdinalIgnoreCase)
            ? EmailLanguage.Spanish
            : EmailLanguage.English;
    }
}

/// <summary>
/// Reads the optional request <c>language</c> leniently: any non-string JSON
/// token is treated as absent (null) so an unrecognized value never fails the
/// request.
/// </summary>
public sealed class LenientLanguageJsonConverter : JsonConverter<string?>
{
    public override string? Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
            return reader.GetString();

        reader.Skip();
        return null;
    }

    public override void Write(
        Utf8JsonWriter writer,
        string? value,
        JsonSerializerOptions options)
    {
        if (value is null)
            writer.WriteNullValue();
        else
            writer.WriteStringValue(value);
    }
}
