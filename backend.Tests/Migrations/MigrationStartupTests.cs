using BudgetPlanner.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace BudgetPlanner.Tests.Migrations;

[Collection("Environment variable tests")]
public sealed class MigrationStartupTests
{
    private static readonly object EnvironmentLock = new();

    [Fact]
    public void Production_style_startup_does_not_apply_database_migrations()
    {
        lock (EnvironmentLock)
        {
            var testConfiguration = new Dictionary<string, string>
            {
                ["ASPNETCORE_ENVIRONMENT"] = "Production",
                ["ConnectionStrings__DefaultConnection"] = "Host=unused-by-tests",
                ["Jwt__Key"] = "test-only-signing-key-that-is-at-least-thirty-two-bytes-long",
                ["EmailSettings__FromName"] = "Ordo Tests",
                ["EmailSettings__FromEmail"] = "sender@example.com",
                ["GoogleEmail__ClientId"] = "test-client-id",
                ["GoogleEmail__ClientSecret"] = "test-client-secret",
                ["GoogleEmail__RefreshToken"] = "test-refresh-token",
                ["Frontend__BaseUrl"] = "https://frontend.test"
            };
            var originalValues = testConfiguration.Keys.ToDictionary(
                key => key,
                Environment.GetEnvironmentVariable);

            try
            {
                foreach (var (key, value) in testConfiguration)
                    Environment.SetEnvironmentVariable(key, value);

                using var app = new ProductionStyleTestApplication();
                using var client = app.CreateClient();

                Assert.NotNull(client);
            }
            finally
            {
                foreach (var (key, value) in originalValues)
                    Environment.SetEnvironmentVariable(key, value);
            }
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Design_time_factory_rejects_missing_migration_connection(string? connectionString)
    {
        var originalValue = Environment.GetEnvironmentVariable(
            BudgetContextFactory.MigrationConnectionEnvironmentVariable);

        try
        {
            Environment.SetEnvironmentVariable(
                BudgetContextFactory.MigrationConnectionEnvironmentVariable,
                connectionString);

            var exception = Assert.Throws<InvalidOperationException>(() =>
                new BudgetContextFactory().CreateDbContext([]));

            Assert.Contains(
                BudgetContextFactory.MigrationConnectionEnvironmentVariable,
                exception.Message);
        }
        finally
        {
            Environment.SetEnvironmentVariable(
                BudgetContextFactory.MigrationConnectionEnvironmentVariable,
                originalValue);
        }
    }

    [Fact]
    public void Design_time_factory_configures_npgsql_from_migration_connection()
    {
        var originalValue = Environment.GetEnvironmentVariable(
            BudgetContextFactory.MigrationConnectionEnvironmentVariable);

        try
        {
            Environment.SetEnvironmentVariable(
                BudgetContextFactory.MigrationConnectionEnvironmentVariable,
                "Host=localhost;Database=budget_planner_test;Username=test;Password=test");

            using var context = new BudgetContextFactory().CreateDbContext([]);

            Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", context.Database.ProviderName);
        }
        finally
        {
            Environment.SetEnvironmentVariable(
                BudgetContextFactory.MigrationConnectionEnvironmentVariable,
                originalValue);
        }
    }
}

[CollectionDefinition("Environment variable tests", DisableParallelization = true)]
public sealed class EnvironmentVariableTestCollection;

internal sealed class ProductionStyleTestApplication : WebApplicationFactory<Program>
{
    private readonly string _databaseName = $"startup-tests-{Guid.NewGuid()}";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Production");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<BudgetContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<BudgetContext>>();
            services.AddDbContext<BudgetContext>(options =>
                options.UseInMemoryDatabase(_databaseName));
        });
    }
}
