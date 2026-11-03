using System.Text;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using BudgetPlanner.Services;
using BudgetPlanner.Authentication;
using BudgetPlanner.Configuration;
using Microsoft.Extensions.Options;
using BudgetPlanner.Import;
using BudgetPlanner.Import.Sunflower;
using BudgetPlanner.Commitments;
using BudgetPlanner.Paychecks;
using BudgetPlanner.Analytics;
using BudgetPlanner.ActivityTimeline;
using BudgetPlanner.Home;
using BudgetPlanner.CreateRequests;
using BudgetPlanner.Diagnostics;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

var builder = WebApplication.CreateBuilder(args);

// The handler logs one privacy-safe line; drop the framework's duplicate full-exception log.
builder.Logging.AddFilter(
    "Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddleware", LogLevel.None);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(
            "http://localhost:5173",
            "https://oli-budget-planner.vercel.app"
        )
        .AllowAnyHeader()
        .AllowAnyMethod();
    });
});

builder.Services.AddControllers();
builder.Services.AddExceptionHandler<UnhandledExceptionHandler>();
builder.Services.AddHealthChecks()
    .AddCheck<DatabaseReadinessCheck>(
        DatabaseReadinessCheck.Name,
        failureStatus: HealthStatus.Unhealthy,
        tags: [DatabaseReadinessCheck.ReadyTag],
        timeout: DatabaseReadinessCheck.DefaultTimeout);
builder.Services.AddSingleton(new PdfExtractionOptions());
builder.Services.AddSingleton<IPdfTextExtractor, ContainedPdfTextExtractor>();
builder.Services.AddSingleton<ISunflowerStatementParser, SunflowerStatementParser>();
builder.Services.AddSingleton<IImportPreviewAdmission, ImportPreviewAdmission>();
builder.Services.AddScoped<ImportPreviewAdmissionFilter>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(new ImportPreviewProcessingOptions());
builder.Services.AddScoped<IImportPreviewService, ImportPreviewService>();
builder.Services.AddSingleton<ICommitmentDetector, CommitmentDetector>();
builder.Services.AddSingleton<ICommitmentChangeDetector, CommitmentChangeDetector>();
builder.Services.AddScoped<ICommitmentService, CommitmentService>();
builder.Services.AddScoped<ICommitmentChangeReadService>(services =>
    (ICommitmentChangeReadService)services.GetRequiredService<ICommitmentService>());
builder.Services.AddSingleton<PaycheckCandidateDetector>();
builder.Services.AddSingleton<PaycheckProjector>();
builder.Services.AddScoped<IPaycheckService, PaycheckService>();
builder.Services.AddScoped<ICashFlowService, CashFlowService>();
builder.Services.AddScoped<IdempotentCreateService>();
builder.Services.AddScoped<IActivityFeedReader, ActivityFeedReader>();
builder.Services.AddScoped<IHomeActivityReader, HomeActivityReader>();
builder.Services.AddScoped<IHomePaycheckReader, HomePaycheckReader>();
builder.Services.AddScoped<IHomeAttentionReader, HomeAttentionReader>();
builder.Services.AddScoped<IHomeReadService, HomeReadService>();

builder.Services
    .AddOptions<EmailSettingsOptions>()
    .Bind(builder.Configuration.GetSection(EmailSettingsOptions.SectionName))
    .ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<EmailSettingsOptions>, EmailSettingsOptionsValidator>();

builder.Services
    .AddOptions<GoogleEmailOptions>()
    .Bind(builder.Configuration.GetSection(GoogleEmailOptions.SectionName))
    .ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<GoogleEmailOptions>, GoogleEmailOptionsValidator>();

builder.Services
    .AddOptions<FrontendOptions>()
    .Bind(builder.Configuration.GetSection(FrontendOptions.SectionName))
    .ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<FrontendOptions>, FrontendOptionsValidator>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "Bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter your JWT token here."
    });

    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

builder.Services.AddDbContext<BudgetContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));
builder.Services
    .AddDataProtection()
    .SetApplicationName("BudgetPlanner")
    .PersistKeysToDbContext<BudgetContext>();
builder.Services
    .AddIdentity<ApplicationUser, IdentityRole>(options =>
    {
        options.SignIn.RequireConfirmedEmail = true;
        options.User.RequireUniqueEmail = true;

        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(10);
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.AllowedForNewUsers = true;
    })
    .AddEntityFrameworkStores<BudgetContext>()
    .AddDefaultTokenProviders();

var jwtKey = builder.Configuration["Jwt:Key"];

if (string.IsNullOrWhiteSpace(jwtKey))
{
    throw new InvalidOperationException("JWT key is missing");
}

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    // #337: after signature, iss/aud and lifetime, the token must belong to a live session.
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = AccessTokenSessionValidation.OnTokenValidatedAsync
    };
    options.TokenValidationParameters = new TokenValidationParameters
    {
        // #301 phase 2: access tokens must carry the fixed iss/aud from AccessTokenClaims.
        ValidateIssuer = true,
        ValidIssuer = AccessTokenClaims.Issuer,
        ValidateAudience = true,
        ValidAudience = AccessTokenClaims.Audience,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(jwtKey)
        )
    };
});

builder.Services.AddAuthorization();
builder.Services.AddSingleton<IGmailApiClient, GmailApiClient>();
builder.Services.AddScoped<IEmailService, EmailService>();
builder.Services.AddScoped<IAccountConfirmationService, AccountConfirmationService>();
builder.Services.AddSingleton<IBackgroundEmailQueue>(_ => new BackgroundEmailQueue());
builder.Services.AddHostedService<BackgroundEmailWorker>();
builder.Services.AddOptions<ConfirmationResendLimiterOptions>();
builder.Services.AddSingleton<IConfirmationResendLimiter, ConfirmationResendLimiter>();
builder.Services.AddOptions<ForgotPasswordLimiterOptions>();
builder.Services.AddSingleton<IForgotPasswordLimiter, ForgotPasswordLimiter>();
builder.Services.AddOptions<RegistrationLimiterOptions>();
builder.Services.AddSingleton<IRegistrationLimiter, RegistrationLimiter>();
builder.Services.AddOptions<ClientIpLimiterOptions>();
builder.Services.AddSingleton<IClientIpLimiter, ClientIpLimiter>();
builder.Services.AddSingleton(PasswordTimingEqualizer.Create);
builder.Services.AddOptions<DeviceSessionOptions>();
builder.Services.AddScoped<IDeviceSessionService, DeviceSessionService>();
builder.Services.AddSingleton<AccessTokenSessionIdProtector>();
builder.Services.AddScoped<WebSessionGuardFilter>();

var app = builder.Build();

// #319: build the dummy sign-in hash at startup, not on the first request.
app.Services.GetRequiredService<PasswordTimingEqualizer>();

// The handler writes the response itself; the no-op satisfies the .NET 9 startup check.
app.UseExceptionHandler(_ => { });

// #332: behind Render's proxy, take the client IP from the rightmost
// X-Forwarded-For entry (the one the edge appends). Left entries are
// client-sent and ignored. The scheme is not forwarded, so HTTPS
// redirection is unchanged. Not applied in Development (no proxy).
if (!app.Environment.IsDevelopment())
{
    var forwardedHeaders = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor,
        ForwardLimit = 1
    };
    forwardedHeaders.KnownNetworks.Clear();
    forwardedHeaders.KnownProxies.Clear();
    app.UseForwardedHeaders(forwardedHeaders);
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseRouting();
app.UseCors();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
// Liveness: runs no checks, never touches the database.
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
// Readiness: database reachability. Fixed body, Degraded and Unhealthy both 503.
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains(DatabaseReadinessCheck.ReadyTag),
    ResultStatusCodes =
    {
        [HealthStatus.Healthy] = StatusCodes.Status200OK,
        [HealthStatus.Degraded] = StatusCodes.Status503ServiceUnavailable,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable,
    },
    AllowCachingResponses = false,
    ResponseWriter = ReadinessResponseWriter.WriteAsync,
}).AllowAnonymous();

app.Run();

public partial class Program;
