using System.Text.Json;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace BudgetPlanner.Diagnostics;

/// <summary>Writes the fixed readiness body. Never includes descriptions, data or exceptions.</summary>
public static class ReadinessResponseWriter
{
    public static Task WriteAsync(HttpContext context, HealthReport report)
    {
        static string Label(HealthStatus status) => status == HealthStatus.Healthy ? "Healthy" : "Unhealthy";

        var database = report.Entries.TryGetValue(DatabaseReadinessCheck.Name, out var entry)
            ? Label(entry.Status)
            : "Unhealthy";
        context.Response.ContentType = "application/json";
        context.Response.Headers.CacheControl = "no-store";
        return context.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            status = Label(report.Status),
            checks = new { database },
        }));
    }
}
