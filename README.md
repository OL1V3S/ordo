# Ordo

A full-stack personal finance application for tracking expenses, setting monthly category budgets, and visualizing spending.

**Live Demo:** https://oli-budget-planner.vercel.app/

> Create an account to explore the authenticated features.

## Features

### Authentication & Account Recovery

- User registration and JWT-based login with ASP.NET Identity
- Email confirmation and password reset flows
- Gmail API email delivery using OAuth credentials
- Resend-confirmation recovery for unconfirmed accounts
- Per-recipient and global rate limiting on confirmation resends
- Neutral resend responses to avoid exposing account state

### Expense Management

- Add, edit, and delete expenses
- Track description, amount, date, and category
- User-specific data isolation
- Search and filter expenses by date range and category

### Budget Management

- Set monthly spending limits by category
- Edit and delete budget limits
- Track spending against configured limits
- Visual indicators when spending approaches or exceeds a budget

### Data Visualization

- Spending summaries by category
- Charts comparing spending with budget limits
- Interactive frontend visualizations built with Chart.js/Recharts

## Tech Stack

### Frontend

- React 19 + Vite
- JavaScript
- React Router
- Axios
- Chart.js / react-chartjs-2
- Recharts

### Backend

- ASP.NET Core 9 Web API
- C#
- Entity Framework Core
- ASP.NET Identity
- JWT Bearer authentication
- Gmail API + MimeKit

### Database

- PostgreSQL in production with Neon
- SQL Server provider available for local development

### Testing

- xUnit
- `WebApplicationFactory<Program>` integration testing
- EF Core InMemory for isolated test data
- Authentication, email-delivery, configuration, validation, rate-limit, and concurrency coverage

### Deployment

- Frontend: Vercel
- Backend: Render
- Database: Neon PostgreSQL
- Backend containerized with Docker

## Project Structure

```text
budget_planner/
├── frontend/        # React/Vite client
├── backend/         # ASP.NET Core Web API
└── backend.Tests/   # xUnit integration and service tests
```

## Local Development

### Prerequisites

- Node.js
- .NET 9 SDK
- PostgreSQL or SQL Server
- Gmail API OAuth credentials if testing email delivery

### 1. Clone the repository

```bash
git clone https://github.com/OL1V3S/budget_planner.git
cd budget_planner
```

### 2. Configure the backend

The backend expects the following configuration values:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "YOUR_CONNECTION_STRING"
  },
  "Jwt": {
    "Key": "YOUR_JWT_SIGNING_KEY"
  },
  "EmailSettings": {
    "FromName": "Ordo",
    "FromEmail": "YOUR_GMAIL_ADDRESS"
  },
  "GoogleEmail": {
    "ClientId": "YOUR_GOOGLE_CLIENT_ID",
    "ClientSecret": "YOUR_GOOGLE_CLIENT_SECRET",
    "RefreshToken": "YOUR_GOOGLE_REFRESH_TOKEN"
  },
  "Frontend": {
    "BaseUrl": "http://localhost:5173"
  }
}
```

Do not commit real credentials. Use local configuration or environment variables for secrets.

Start the backend:

```bash
cd backend
dotnet restore
dotnet run
```

The default HTTP development URL is:

```text
http://localhost:5298
```

## Production Database Migrations

Normal backend startup never creates or updates the database schema. Production
migrations are a separate administrator operation and must be completed deliberately
from the exact reviewed application commit.

Never commit a production connection string. For schema migrations, obtain a
direct, non-pooled Neon PostgreSQL connection string and provide it only through
the `BUDGETPLANNER_MIGRATION_CONNECTION` environment variable in the authorized
operator's local session.

### Review and apply a migration

1. Check out the exact reviewed commit that contains the migration.
2. Restore the repository-pinned EF Core tool and build the backend:

   ```bash
   dotnet tool restore
   dotnet build backend/backend.csproj --configuration Release
   ```

3. Set `BUDGETPLANNER_MIGRATION_CONNECTION` in the current shell to the direct
   Neon connection string. Do not pass credentials on the command line or store
   them in a tracked file.
4. Generate an idempotent SQL script for inspection without applying it:

   ```bash
   dotnet ef migrations script --idempotent \
     --project backend \
     --startup-project backend \
     --context BudgetContext \
     --configuration Release \
     --no-build \
     --output /tmp/ordo-migration.sql
   ```

5. Inspect the entire generated script, confirm the target database and expected
   migration range, and obtain any additional review or recovery point required
   for destructive operations.
6. Apply pending migrations deliberately:

   ```bash
   dotnet ef database update \
     --project backend \
     --startup-project backend \
     --context BudgetContext \
     --configuration Release \
     --no-build
   ```

7. Verify the expected migration IDs in the production database's
   `__EFMigrationsHistory` table.
8. Deploy the corresponding application commit to Render and smoke-test a
   database-backed backend request.
9. Unset `BUDGETPLANNER_MIGRATION_CONNECTION` and remove the generated script
   when it is no longer required.

Apply schema changes before deploying application code that requires them. Keep
migrations backward-compatible with the currently running application whenever
possible. Render Free does not provide pre-deploy commands or one-off jobs, so do
not move migration execution into the Docker start command or normal application
startup.

Rolling back an application deployment does not roll back the database schema.
Prefer a forward corrective migration once production data has changed. Destructive
or backward-incompatible migrations require extra review and a verified Neon
backup, branch, or other recovery plan appropriate to the active Neon plan before
execution.

## Data Protection key persistence

ASP.NET Core Identity confirmation and password-reset tokens depend on the
application's Data Protection key ring. Render Free has an ephemeral filesystem,
so the backend uses the stable application name `BudgetPlanner` and persists the
key ring in Neon's `DataProtectionKeys` table instead of the container filesystem.
This lets outstanding tokens remain valid across normal restarts and redeploys,
subject to their existing expiration and Identity security-stamp semantics.

The V1 key XML is not additionally wrapped with an application-managed certificate.
This deployment relies on Neon's platform encryption at rest, TLS, PostgreSQL
access controls, Render secret storage for the connection string, and restricted
Render/Neon account access. A principal or database dump that can logically read
`DataProtectionKeys.Xml` may therefore obtain usable Data Protection master-key
material. Treat database credentials and dumps as highly sensitive, never log or
expose the key XML, and don't commit key material.

Don't delete old Data Protection keys as routine cleanup. Deletion can permanently
invalidate outstanding protected payloads. The first deployment that enables
database persistence also can't rescue tokens generated with old ephemeral keys
that have already been lost.

Apply the migration that creates `DataProtectionKeys` and verify it in Neon before
merging or deploying application code that uses database-backed keys. The current
application can remain live while this additive migration is applied. Afterward,
verify the migration history and table, deploy the matching commit, generate a
fresh confirmation or reset token, restart/redeploy Render, and confirm that the
pre-restart token still works.

### 3. Configure and run the frontend

In a separate terminal:

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
VITE_API_BASE_URL=http://localhost:5298
```

Then run:

```bash
npm run dev
```

### 4. Run verification

Backend tests:

```bash
dotnet test backend.Tests/backend.Tests.csproj
```

Frontend lint and production build:

```bash
cd frontend
npm run lint
npm run build
```

## Engineering Highlights

- Full-stack React + ASP.NET Core architecture with a relational database
- Authentication built on ASP.NET Identity and JWTs
- Account-confirmation recovery designed around both reliability and account-enumeration resistance
- Gmail API integration with validated configuration and explicit delivery-failure handling
- Automated integration coverage for authentication and failure scenarios, including rate limiting and concurrent requests
- Separate frontend, backend, and database deployments across Vercel, Render, and Neon

## Author

**Oliver Triana**

[LinkedIn](https://www.linkedin.com/in/oliver-triana/) · [GitHub](https://github.com/OL1V3S)

## License

This project is for educational and portfolio purposes.
