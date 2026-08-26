using System.Xml.Linq;
using System.Security.Cryptography;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

[Collection("Environment variable tests")]
public sealed class DataProtectionPersistenceTests
{
    [Fact]
    public async Task Confirmation_token_survives_application_restart_and_replay_behavior_is_unchanged()
    {
        await RunWithTestEnvironmentAsync(async () =>
        {
            var persistence = new RestartPersistenceFixture();
            var (userId, token) = await GenerateConfirmationTokenAsync(persistence);

            using var restartedApp = persistence.CreateApplication();
            var firstResult = await UseUserManagerAsync(restartedApp, async users =>
            {
                var user = await RequireUserAsync(users, userId);
                return await users.ConfirmEmailAsync(user, token);
            });
            var replayResult = await UseUserManagerAsync(restartedApp, async users =>
            {
                var user = await RequireUserAsync(users, userId);
                return await users.ConfirmEmailAsync(user, token);
            });

            Assert.True(firstResult.Succeeded);
            Assert.True(replayResult.Succeeded);
        });
    }

    [Fact]
    public async Task Password_reset_token_survives_application_restart_and_remains_single_use()
    {
        await RunWithTestEnvironmentAsync(async () =>
        {
            var persistence = new RestartPersistenceFixture();
            string userId;
            string token;

            using (var firstApp = persistence.CreateApplication())
            {
                (userId, token) = await UseUserManagerAsync(firstApp, async users =>
                {
                    var user = await CreateUserAsync(users, "restart-reset@example.com");
                    return (user.Id, await users.GeneratePasswordResetTokenAsync(user));
                });
            }

            using var restartedApp = persistence.CreateApplication();
            var firstResult = await UseUserManagerAsync(restartedApp, async users =>
            {
                var user = await RequireUserAsync(users, userId);
                return await users.ResetPasswordAsync(user, token, "NewPassword1!");
            });
            var replayResult = await UseUserManagerAsync(restartedApp, async users =>
            {
                var user = await RequireUserAsync(users, userId);
                return await users.ResetPasswordAsync(user, token, "AnotherPassword1!");
            });

            Assert.True(firstResult.Succeeded);
            Assert.False(replayResult.Succeeded);
            Assert.Contains(replayResult.Errors, error => error.Code == "InvalidToken");
        });
    }

    [Fact]
    public async Task Expired_confirmation_token_remains_expired_after_application_restart()
    {
        await RunWithTestEnvironmentAsync(async () =>
        {
            var persistence = new RestartPersistenceFixture(TimeSpan.FromTicks(-1));
            var (userId, token) = await GenerateConfirmationTokenAsync(persistence);

            using var restartedApp = persistence.CreateApplication();
            var result = await UseUserManagerAsync(restartedApp, async users =>
            {
                var user = await RequireUserAsync(users, userId);
                return await users.ConfirmEmailAsync(user, token);
            });

            Assert.False(result.Succeeded);
            Assert.Contains(result.Errors, error => error.Code == "InvalidToken");
        });
    }

    [Fact]
    public async Task Restart_test_uses_isolated_in_memory_database_and_ef_key_repository()
    {
        await RunWithTestEnvironmentAsync(() =>
        {
            var persistence = new RestartPersistenceFixture();
            using var app = persistence.CreateApplication();
            using var scope = app.Services.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var keyOptions = app.Services.GetRequiredService<IOptions<KeyManagementOptions>>().Value;

            Assert.Equal("Microsoft.EntityFrameworkCore.InMemory", context.Database.ProviderName);
            Assert.IsType<EntityFrameworkCoreXmlRepository<BudgetContext>>(keyOptions.XmlRepository);
            var configuredConnection = app.Services.GetRequiredService<IConfiguration>()
                .GetConnectionString("DefaultConnection");
            Assert.DoesNotContain("neon", configuredConnection ?? string.Empty,
                StringComparison.OrdinalIgnoreCase);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task Inaccessible_key_repository_fails_without_ephemeral_fallback()
    {
        await RunWithTestEnvironmentAsync(async () =>
        {
            var persistence = new RestartPersistenceFixture(failKeyRepository: true);
            using var app = persistence.CreateApplication();

            var exception = await Assert.ThrowsAsync<CryptographicException>(() =>
                UseUserManagerAsync(app, async users =>
                {
                    var user = await CreateUserAsync(users, "failing-keys@example.com");
                    return await users.GenerateEmailConfirmationTokenAsync(user);
                }));

            var repositoryException = Assert.IsType<InvalidOperationException>(exception.InnerException);
            Assert.Equal(ThrowingXmlRepository.ErrorMessage, repositoryException.Message);
        });
    }

    private static async Task<(string UserId, string Token)> GenerateConfirmationTokenAsync(
        RestartPersistenceFixture persistence)
    {
        using var firstApp = persistence.CreateApplication();
        return await UseUserManagerAsync(firstApp, async users =>
        {
            var user = await CreateUserAsync(users, $"restart-confirmation-{Guid.NewGuid()}@example.com");
            return (user.Id, await users.GenerateEmailConfirmationTokenAsync(user));
        });
    }

    private static async Task<ApplicationUser> CreateUserAsync(
        UserManager<ApplicationUser> users,
        string email)
    {
        var user = new ApplicationUser { UserName = email, Email = email };
        var result = await users.CreateAsync(user, "Password1!");
        Assert.True(result.Succeeded, string.Join(", ", result.Errors.Select(error => error.Description)));
        return user;
    }

    private static async Task<ApplicationUser> RequireUserAsync(
        UserManager<ApplicationUser> users,
        string userId)
    {
        var user = await users.FindByIdAsync(userId);
        Assert.NotNull(user);
        return user;
    }

    private static async Task<TResult> UseUserManagerAsync<TResult>(
        RestartPersistenceApplication app,
        Func<UserManager<ApplicationUser>, Task<TResult>> action)
    {
        using var scope = app.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>());
    }

    private static async Task RunWithTestEnvironmentAsync(Func<Task> test)
    {
        var originalEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        var originalJwtKey = Environment.GetEnvironmentVariable("Jwt__Key");

        try
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Testing");
            Environment.SetEnvironmentVariable(
                "Jwt__Key",
                "test-only-signing-key-that-is-at-least-thirty-two-bytes-long");
            await test();
        }
        finally
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", originalEnvironment);
            Environment.SetEnvironmentVariable("Jwt__Key", originalJwtKey);
        }
    }
}

internal sealed class RestartPersistenceFixture(
    TimeSpan? tokenLifespan = null,
    bool failKeyRepository = false)
{
    private readonly string _databaseName = $"data-protection-restart-{Guid.NewGuid()}";
    private readonly InMemoryDatabaseRoot _databaseRoot = new();

    public RestartPersistenceApplication CreateApplication() =>
        new(_databaseName, _databaseRoot, tokenLifespan, failKeyRepository);
}

internal sealed class RestartPersistenceApplication(
    string databaseName,
    InMemoryDatabaseRoot databaseRoot,
    TimeSpan? tokenLifespan,
    bool failKeyRepository) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<BudgetContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<BudgetContext>>();
            services.AddDbContext<BudgetContext>(options =>
                options.UseInMemoryDatabase(databaseName, databaseRoot));

            if (tokenLifespan != null)
            {
                services.Configure<DataProtectionTokenProviderOptions>(options =>
                    options.TokenLifespan = tokenLifespan.Value);
            }

            if (failKeyRepository)
            {
                services.PostConfigure<KeyManagementOptions>(options =>
                    options.XmlRepository = new ThrowingXmlRepository());
            }
        });
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.ConfigureAppConfiguration(configuration =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = "Host=unused-by-tests",
                ["Jwt:Key"] = "test-only-signing-key-that-is-at-least-thirty-two-bytes-long",
                ["EmailSettings:FromName"] = "Ordo Tests",
                ["EmailSettings:FromEmail"] = "sender@example.com",
                ["GoogleEmail:ClientId"] = "test-client-id",
                ["GoogleEmail:ClientSecret"] = "test-client-secret",
                ["GoogleEmail:RefreshToken"] = "test-refresh-token",
                ["Frontend:BaseUrl"] = "https://frontend.test"
            }));

        return base.CreateHost(builder);
    }
}

internal sealed class ThrowingXmlRepository : IXmlRepository
{
    public const string ErrorMessage = "Test Data Protection key repository is inaccessible.";

    public IReadOnlyCollection<XElement> GetAllElements() =>
        throw new InvalidOperationException(ErrorMessage);

    public void StoreElement(XElement element, string friendlyName) =>
        throw new InvalidOperationException(ErrorMessage);
}
