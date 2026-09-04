using System.Text;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
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

var builder = WebApplication.CreateBuilder(args);

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
builder.Services.AddSingleton<PaycheckCandidateDetector>();
builder.Services.AddSingleton<PaycheckProjector>();
builder.Services.AddScoped<IPaycheckService, PaycheckService>();

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
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = false,
        ValidateAudience = false,
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
builder.Services.AddOptions<ConfirmationResendLimiterOptions>();
builder.Services.AddSingleton<IConfirmationResendLimiter, ConfirmationResendLimiter>();
builder.Services.AddOptions<ForgotPasswordLimiterOptions>();
builder.Services.AddSingleton<IForgotPasswordLimiter, ForgotPasswordLimiter>();

var app = builder.Build();

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

app.Run();

public partial class Program;
