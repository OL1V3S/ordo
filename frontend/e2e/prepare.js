// Prepares the disposable E2E database (#336): guard, drop and create, apply the
// same EF migrations as production, seed one confirmed test user. Needs `psql`
// and the .NET SDK. Run through `npm run test:e2e` or `node e2e/prepare.js`.
import { spawnSync } from 'node:child_process'
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildE2eEnvironment, buildPsqlInvocation } from './safety.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const stateDirectory = path.join(here, '.state')

// ASP.NET Core Identity v3 hash: 0x01 | prf (2 = HMACSHA512) | iterations |
// salt length | salt | 32-byte subkey. Matches the framework defaults, so
// sign-in does not rewrite it.
export function identityV3Hash(password, salt = randomBytes(16)) {
  const iterations = 100000
  const header = Buffer.alloc(13)
  header.writeUInt8(0x01, 0)
  header.writeUInt32BE(2, 1)
  header.writeUInt32BE(iterations, 5)
  header.writeUInt32BE(salt.length, 9)
  const subkey = pbkdf2Sync(password, salt, iterations, 32, 'sha512')
  return Buffer.concat([header, salt, subkey]).toString('base64')
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: ['pipe', 'inherit', 'inherit'], encoding: 'utf8', ...options })
  if (result.error?.code === 'ENOENT') {
    throw new Error(`${command} was not found on PATH. Install it to run the E2E suite (see docs/verification.md).`)
  }
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ''} failed with exit code ${result.status}`)
}

export function prepare() {
  const { env, settings } = buildE2eEnvironment(process.env)
  const psql = (database, args, input) => {
    const target = buildPsqlInvocation(env, settings, database)
    run('psql', [...target.args, ...args], { env: target.env, input })
  }

  console.log(`E2E: recreating ${settings.database} on ${settings.host}:${settings.port}`)
  psql('postgres', [
    '-c', `DROP DATABASE IF EXISTS "${settings.database}" WITH (FORCE)`,
    '-c', `CREATE DATABASE "${settings.database}"`,
  ])

  run('dotnet', ['tool', 'restore'], { cwd: repoRoot, env })
  run('dotnet', ['ef', 'database', 'update', '--project', 'backend/backend.csproj'], { cwd: repoRoot, env })

  const runId = randomBytes(4).toString('hex')
  const account = {
    runId,
    userId: randomUUID(),
    email: `e2e-${runId}@example.invalid`,
    password: `E2e-${randomBytes(12).toString('hex')}-Aa1!`,
  }
  // Every value is generated above (hex, uuid, base64), so none needs quoting beyond this.
  const sql = `INSERT INTO "AspNetUsers"
    ("Id", "UserName", "NormalizedUserName", "Email", "NormalizedEmail", "EmailConfirmed",
     "PasswordHash", "SecurityStamp", "ConcurrencyStamp", "PhoneNumberConfirmed",
     "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
    VALUES ('${account.userId}', '${account.email}', '${account.email.toUpperCase()}',
     '${account.email}', '${account.email.toUpperCase()}', true,
     '${identityV3Hash(account.password)}', '${randomUUID()}', '${randomUUID()}', false,
     false, true, 0);`
  psql(settings.database, ['-f', '-'], sql)

  // Gitignored; holds only the synthetic per-run test account.
  mkdirSync(stateDirectory, { recursive: true })
  writeFileSync(path.join(stateDirectory, 'account.json'), JSON.stringify(account, null, 2))
  console.log(`E2E: seeded ${account.email}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    prepare()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
