import { describe, expect, it } from 'vitest'
import {
  API_CONNECTION_VARIABLE,
  E2E_DATABASE,
  MIGRATION_CONNECTION_VARIABLE,
  assertSafeConnectionString,
  assertSafeSettings,
  buildConnectionString,
  buildE2eEnvironment,
  readSettings,
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
