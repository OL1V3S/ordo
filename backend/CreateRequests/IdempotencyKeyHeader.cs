using Microsoft.AspNetCore.Http;

namespace BudgetPlanner.CreateRequests;

public enum IdempotencyKeyStatus
{
    Absent,
    Valid,
    Invalid
}

public readonly record struct IdempotencyKeyReadResult(IdempotencyKeyStatus Status, Guid Key);

public static class IdempotencyKeyHeader
{
    public const string HeaderName = "Idempotency-Key";

    /// <summary>
    /// Reads the header straight from the request so repeated headers are detected.
    /// A valid key is exactly one canonical 36-character UUID that is not all zero.
    /// </summary>
    public static IdempotencyKeyReadResult Read(IHeaderDictionary headers)
    {
        if (!headers.TryGetValue(HeaderName, out var values))
        {
            return new(IdempotencyKeyStatus.Absent, Guid.Empty);
        }

        if (values.Count != 1)
        {
            return new(IdempotencyKeyStatus.Invalid, Guid.Empty);
        }

        return TryParse(values[0], out var key)
            ? new(IdempotencyKeyStatus.Valid, key)
            : new(IdempotencyKeyStatus.Invalid, Guid.Empty);
    }

    public static bool TryParse(string? value, out Guid key)
    {
        key = Guid.Empty;
        if (value is null || value.Length != 36 || !Guid.TryParseExact(value, "D", out var parsed)
            || parsed == Guid.Empty)
        {
            return false;
        }

        key = parsed;
        return true;
    }
}
