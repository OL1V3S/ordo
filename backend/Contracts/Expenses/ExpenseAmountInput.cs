using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace BudgetPlanner.Contracts.Expenses;

public enum ExpenseAmountParseFailure
{
    None,
    Invalid,
    OutOfRange
}

[JsonConverter(typeof(ExpenseAmountInputJsonConverter))]
public sealed partial record ExpenseAmountInput(string? Text, bool IsSupportedToken)
{
    [GeneratedRegex(@"^-?(?:\d+(?:\.\d+)?|\.\d+)$", RegexOptions.CultureInvariant)]
    private static partial Regex DecimalPattern();

    public ExpenseAmountParseFailure TryGetDecimal(out decimal amount)
    {
        amount = default;
        var text = Text?.Trim();
        if (!IsSupportedToken || string.IsNullOrEmpty(text) || !DecimalPattern().IsMatch(text))
        {
            return ExpenseAmountParseFailure.Invalid;
        }

        return decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
            CultureInfo.InvariantCulture, out amount)
            ? ExpenseAmountParseFailure.None
            : ExpenseAmountParseFailure.OutOfRange;
    }
}

public sealed class ExpenseAmountInputJsonConverter : JsonConverter<ExpenseAmountInput>
{
    public override ExpenseAmountInput Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            return new ExpenseAmountInput(reader.GetString(), true);
        }

        using var value = JsonDocument.ParseValue(ref reader);
        return value.RootElement.ValueKind == JsonValueKind.Number
            ? new ExpenseAmountInput(value.RootElement.GetRawText(), true)
            : new ExpenseAmountInput(null, false);
    }

    public override void Write(Utf8JsonWriter writer, ExpenseAmountInput value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.Text);
}
