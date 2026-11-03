import { describe, expect, it } from 'vitest'
import {
  ADMIN_DATABASE,
  API_CONNECTION_VARIABLE,
  E2E_DATABASE,
  MIGRATION_CONNECTION_VARIABLE,
  assertSafeConnectionString,
  assertSafeSettings,
  buildConnectionString,
  buildE2eEnvironment,
  buildPsqlInvocation,
  pgVariableNames,
  readSettings,
  removePgVariables,
} from './safety.js'

const good = { host: 'localhost', port: '5432', database: E2E_DATABASE, user: 'postgres', password: 'secret1' }

describe('E2E database safety guard', () => {
  it('builds the local default connection string', () => {
    expect(buildConnectionString(readSettings({}))).toBe(
      `Host=localhost;Port=5432;Database=${E2E_DATABASE};Username=postgres;Password=postgres`,
    )
  })

  it.each(['localhost', '127.0.0.1', '::1'])('allows local host %s', (host) => {
    expect(() => assertSafeSettings({ ...good, host })).not.toThrow()
  })

  it.each([
    'db.example.com',
    'ep-cool-dawn-123.neon.tech',
    'localhost,ep-prod.neon.tech',
    'localhost;Host=prod.example.com',
    '',
  ])('refuses remote or malformed host %j', (host) => {
    expect(() => assertSafeSettings({ ...good, host })).toThrow(/safety guard/)
  })

  it.each(['budget_planner', 'budget_planner_test', 'neondb', `${E2E_DATABASE}_x`, `${E2E_DATABASE};Host=prod`, ''])(
    'refuses database %j',
    (database) => {
      expect(() => assertSafeSettings({ ...good, database })).toThrow(/safety guard/)
    },
  )

  it.each([
    ['port', '5432;Host=prod'],
    ['port', '5432,5433'],
    ['user', 'postgres;Host=prod'],
    ['user', 'a,b'],
    ['password', 'pw;Host=prod.example.com'],
    ['password', 'pw,Host=prod'],
    ['password', 'has space'],
    ['password', ''],
  ])('refuses injected %s %j', (field, value) => {
    expect(() => assertSafeSettings({ ...good, [field]: value })).toThrow(/safety guard/)
  })

  it('does not echo the password in errors', () => {
    expect(() => assertSafeSettings({ ...good, password: 'super;secret' })).toThrow(/safety guard/)
    try {
      assertSafeSettings({ ...good, password: 'super;secret' })
    } catch (error) {
      expect(error.message).not.toContain('super')
    }
  })

  it('rechecks the final connection string', () => {
    expect(() => assertSafeConnectionString(buildConnectionString(good))).not.toThrow()
    expect(() => assertSafeConnectionString('Host=localhost,prod.example.com;Port=5432;Database=budget_planner_test_e2e;Username=u;Password=p')).toThrow(/safety guard/)
    expect(() => assertSafeConnectionString(`Host=prod.example.com;Port=5432;Database=${E2E_DATABASE};Username=u;Password=p`)).toThrow(/safety guard/)
    expect(() => assertSafeConnectionString(`Host=localhost;Port=5432;Database=${E2E_DATABASE};Username=u;Password=p;Host=prod.example.com`)).toThrow(/safety guard/)
    expect(() => assertSafeConnectionString(`Host=localhost;Port=5432;Database=neondb;Username=u;Password=p`)).toThrow(/safety guard/)
  })

  it('overwrites an inherited production connection string', () => {
    const production = 'Host=ep-prod.neon.tech;Database=neondb;Username=owner;Password=prod-secret;SSL Mode=Require'
    const { env, connectionString } = buildE2eEnvironment({
      [MIGRATION_CONNECTION_VARIABLE]: production,
      [API_CONNECTION_VARIABLE]: production,
      PATH: '/usr/bin',
    })
    expect(env[MIGRATION_CONNECTION_VARIABLE]).toBe(connectionString)
    expect(env[API_CONNECTION_VARIABLE]).toBe(connectionString)
    expect(connectionString).toContain(`Database=${E2E_DATABASE}`)
    expect(JSON.stringify(env)).not.toContain('neon.tech')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('refuses when the operator points the E2E settings at a remote host', () => {
    expect(() => buildE2eEnvironment({ BUDGETPLANNER_E2E_PG_HOST: 'ep-prod.neon.tech' })).toThrow(/safety guard/)
    expect(() => buildE2eEnvironment({ BUDGETPLANNER_E2E_PG_DATABASE: 'neondb' })).toThrow(/safety guard/)
  })
})

describe('inherited PG* variables', () => {
  const inherited = {
    PGHOSTADDR: '203.0.113.1',
    PGSERVICE: 'production',
    PGSERVICEFILE: '/home/dev/.pg_service.conf',
    PGSYSCONFDIR: '/etc/production',
    PGHOST: 'ep-prod.neon.tech',
    PGPORT: '6543',
    PGDATABASE: 'neondb',
    PGUSER: 'owner',
    PGPASSWORD: 'prod-secret',
    PGPASSFILE: '/home/dev/.pgpass',
    PGOPTIONS: '-c search_path=production',
    PGSSLMODE: 'require',
    pghostaddr: '203.0.113.2',
    PATH: '/usr/bin',
    HOME: '/home/dev',
  }
  const isPg = (key) => /^PG/i.test(key)

  it('lists PG* names regardless of case, so the Playwright config can delete them from process.env', () => {
    expect(pgVariableNames(inherited).sort()).toEqual(Object.keys(inherited).filter(isPg).sort())
    expect(pgVariableNames({ PATH: '/usr/bin', HOME: '/home/dev' })).toEqual([])
  })

  it('removes every PG* key, keeps the rest, and does not mutate the input', () => {
    const before = { ...inherited }
    const scrubbed = removePgVariables(inherited)
    expect(Object.keys(scrubbed).filter(isPg)).toEqual([])
    expect(scrubbed).toEqual({ PATH: '/usr/bin', HOME: '/home/dev' })
    expect(inherited).toEqual(before)
  })

  it.each(['PGHOSTADDR', 'PGSERVICE', 'PGHOST', 'PGOPTIONS', 'PGPASSFILE', 'PGSERVICEFILE'])(
    'does not pass inherited %s to psql',
    (name) => {
      const { env } = buildPsqlInvocation({ [name]: 'inherited-value', PATH: '/usr/bin' }, good, E2E_DATABASE)
      expect(env).not.toHaveProperty(name)
      expect(JSON.stringify(env)).not.toContain('inherited-value')
      expect(env.PATH).toBe('/usr/bin')
    },
  )

  it('gives psql only the validated values', () => {
    const { args, env } = buildPsqlInvocation(inherited, good, E2E_DATABASE)
    expect(Object.keys(env).filter(isPg)).toEqual(['PGPASSWORD'])
    expect(env.PGPASSWORD).toBe(good.password)
    expect(env.PATH).toBe('/usr/bin')
    expect(args).toEqual([
      '-X', '-q', '-v', 'ON_ERROR_STOP=1',
      '-h', good.host, '-p', good.port, '-U', good.user, '-d', E2E_DATABASE,
    ])
    const text = JSON.stringify({ args, env })
    for (const value of ['203.0.113.', 'production', 'neon.tech', 'neondb', 'owner', 'prod-secret', '6543']) {
      expect(text).not.toContain(value)
    }
  })

  it('allows the admin database for DROP and CREATE only', () => {
    expect(buildPsqlInvocation({}, good, ADMIN_DATABASE).args.slice(-2)).toEqual(['-d', ADMIN_DATABASE])
    for (const database of ['neondb', 'budget_planner', `${E2E_DATABASE}_x`, '', 'host=prod.example.com dbname=postgres']) {
      expect(() => buildPsqlInvocation({}, good, database)).toThrow(/safety guard/)
    }
  })

  it('refuses unsafe settings before building a psql invocation', () => {
    expect(() => buildPsqlInvocation({}, { ...good, host: 'ep-prod.neon.tech' }, E2E_DATABASE)).toThrow(/safety guard/)
    expect(() => buildPsqlInvocation({}, { ...good, database: 'neondb' }, E2E_DATABASE)).toThrow(/safety guard/)
  })

  it('drops them from the dotnet ef and API environment too', () => {
    const { env, connectionString } = buildE2eEnvironment(inherited)
    expect(Object.keys(env).filter(isPg)).toEqual([])
    expect(env[API_CONNECTION_VARIABLE]).toBe(connectionString)
    expect(env.PATH).toBe('/usr/bin')
  })
})
