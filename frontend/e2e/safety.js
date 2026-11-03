// Guard for the browser E2E stack (#336). Pure functions, no I/O, so
// safety.test.js runs in the required Frontend CI job.
//
// The E2E database is dropped and recreated on every run. Only a local
// PostgreSQL database named exactly `budget_planner_test_e2e` is ever allowed.
// The connection string is always built here from validated parts and written
// over any inherited value, including BUDGETPLANNER_MIGRATION_CONNECTION, which
// the operator README tells people to export for production migrations.

export const E2E_DATABASE = 'budget_planner_test_e2e'
export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1']
export const MIGRATION_CONNECTION_VARIABLE = 'BUDGETPLANNER_MIGRATION_CONNECTION'
export const API_CONNECTION_VARIABLE = 'ConnectionStrings__DefaultConnection'

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/
const PASSWORD_PATTERN = /^[^\s;,='"\\]+$/
const PORT_PATTERN = /^[0-9]{1,5}$/
const CONNECTION_KEYS = ['Host', 'Port', 'Database', 'Username', 'Password']

export function readSettings(env = process.env) {
  return {
    host: env.BUDGETPLANNER_E2E_PG_HOST ?? 'localhost',
    port: env.BUDGETPLANNER_E2E_PG_PORT ?? '5432',
    database: env.BUDGETPLANNER_E2E_PG_DATABASE ?? E2E_DATABASE,
    user: env.BUDGETPLANNER_E2E_PG_USER ?? 'postgres',
    password: env.BUDGETPLANNER_E2E_PG_PASSWORD ?? 'postgres',
  }
}

function refuse(reason) {
  return new Error(`E2E safety guard refused the database target: ${reason}. The E2E database is dropped on every run, so only local ${E2E_DATABASE} is allowed.`)
}

export function assertSafeSettings(settings) {
  const { host, port, database, user, password } = settings
  if (!LOCAL_HOSTS.includes(host)) throw refuse(`host must be one of ${LOCAL_HOSTS.join(', ')}`)
  if (typeof port !== 'string' || !PORT_PATTERN.test(port)) throw refuse('port must be digits only')
  if (database !== E2E_DATABASE) throw refuse(`database must be exactly ${E2E_DATABASE}`)
  if (typeof user !== 'string' || !NAME_PATTERN.test(user)) throw refuse('user has unsupported characters')
  // Never echo the password.
  if (typeof password !== 'string' || !PASSWORD_PATTERN.test(password)) {
    throw refuse('password is empty or contains whitespace, ; , = quotes or backslash')
  }
  return settings
}

// Re-checks the final string, because Npgsql accepts `,` in Host (a multi-host
// list) and later keys override earlier ones.
export function assertSafeConnectionString(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.includes(',')) {
    throw refuse('connection string must not contain a comma')
  }
  const pairs = connectionString.split(';').map((part) => {
    const at = part.indexOf('=')
    return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)]
  })
  const keys = pairs.map(([key]) => key)
  if (keys.length !== CONNECTION_KEYS.length || CONNECTION_KEYS.some((key, i) => keys[i] !== key)) {
    throw refuse(`connection string must contain exactly ${CONNECTION_KEYS.join(', ')}`)
  }
  const value = Object.fromEntries(pairs)
  if (!LOCAL_HOSTS.includes(value.Host)) throw refuse('connection string host is not local')
  if (value.Database !== E2E_DATABASE) throw refuse(`connection string database is not ${E2E_DATABASE}`)
  return connectionString
}

export function buildConnectionString(settings) {
  assertSafeSettings(settings)
  const { host, port, database, user, password } = settings
  return assertSafeConnectionString(
    `Host=${host};Port=${port};Database=${database};Username=${user};Password=${password}`,
  )
}

// Returns a fresh environment for every child process. Both connection variables
// are overwritten, so an inherited production value can never reach `dotnet ef`
// or the API.
export function buildE2eEnvironment(baseEnv = process.env) {
  const settings = readSettings(baseEnv)
  const connectionString = buildConnectionString(settings)
  return {
    settings,
    connectionString,
    env: {
      ...baseEnv,
      [MIGRATION_CONNECTION_VARIABLE]: connectionString,
      [API_CONNECTION_VARIABLE]: connectionString,
    },
  }
}
