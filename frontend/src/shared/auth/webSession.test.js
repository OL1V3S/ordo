import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/webSessionClient', () => ({
  webSessionClient: { signIn: vi.fn(), refresh: vi.fn(), signOut: vi.fn() },
}))

const HOUR = 60 * 60 * 1000

function jwt(msFromNow) {
  const payload = btoa(JSON.stringify({ exp: Math.floor((Date.now() + msFromNow) / 1000) }))
  return `header.${payload}.signature`
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function httpError(status, data = '') {
  const error = new Error(`Request failed with status code ${status}`)
  error.response = { status, data }
  return error
}

const posted = []
class FakeChannel {
  static instances = []
  constructor(name) { this.name = name; this.listeners = []; FakeChannel.instances.push(this) }
  postMessage(message) { posted.push({ name: this.name, message }) }
  addEventListener(_type, listener) { this.listeners.push(listener) }
  close() {}
}

let mod
let session
let client

async function load() {
  vi.clearAllMocks()
  vi.resetModules()
  mod = await import('./webSession')
  session = await import('./session')
  client = (await import('../api/webSessionClient')).webSessionClient
}

describe('web-session orchestration', () => {
  beforeEach(async () => {
    localStorage.clear()
    posted.length = 0
    FakeChannel.instances = []
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    await load()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('runs one refresh per tab for concurrent callers', async () => {
    const pending = deferred()
    client.refresh.mockReturnValue(pending.promise)
    session.establishSession(jwt(-1000), 'person@example.invalid')

    const first = mod.refreshWebSession({ reason: 'unauthorized' })
    const second = mod.refreshWebSession({ reason: 'unauthorized' })
    await Promise.resolve()
    pending.resolve({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })

    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(client.refresh).toHaveBeenCalledOnce()
  })

  it('refreshes under the cross-tab lock and skips when another tab already refreshed', async () => {
    const triggerToken = jwt(60 * 1000)
    session.establishSession(triggerToken, 'person@example.invalid')
    const request = vi.fn(async (name, task) => {
      // Another tab held the lock and stored a new token meanwhile.
      localStorage.setItem('token', jwt(2 * HOUR))
      return task()
    })
    vi.stubGlobal('navigator', { locks: { request } })

    const refreshed = await mod.refreshWebSession({ triggerToken, reason: 'unauthorized' })

    expect(refreshed).toBe(true)
    expect(request).toHaveBeenCalledWith('ordo-web-session-refresh', expect.any(Function))
    expect(client.refresh).not.toHaveBeenCalled()
  })

  it('skips a scheduled refresh when the stored token still has well over the lead time left', async () => {
    const token = jwt(HOUR)
    session.establishSession(token, 'person@example.invalid')

    expect(await mod.refreshWebSession({ triggerToken: token })).toBe(true)
    expect(client.refresh).not.toHaveBeenCalled()
  })

  it('keeps session identity across a refresh', async () => {
    session.establishSession(jwt(60 * 1000), 'person@example.invalid')
    const before = session.getSessionSnapshot()
    const listener = vi.fn()
    session.subscribeToSession(listener)
    const next = jwt(2 * HOUR)
    client.refresh.mockResolvedValue({ status: 200, data: { token: next, email: 'person@example.invalid' } })

    expect(await mod.refreshWebSession({ reason: 'unauthorized' })).toBe(true)

    expect(session.getAccessToken()).toBe(next)
    expect(session.getSessionSnapshot()).toBe(before)
    expect(localStorage.getItem('sessionId')).toBe(before.id)
  })

  it('clears the session and signs out other tabs when the refresh returns 401', async () => {
    client.refresh.mockRejectedValue(httpError(401, { code: 'session_invalid' }))
    await mod.startWebSession()
    session.establishSession(jwt(60 * 1000), 'person@example.invalid')

    expect(await mod.refreshWebSession({ reason: 'unauthorized' })).toBe(false)

    expect(session.getAccessToken()).toBeNull()
    expect(session.getSessionSnapshot().signedIn).toBe(false)
    expect(posted).toEqual([{ name: 'ordo-session', message: { type: 'signed-out' } }])
  })

  it.each([
    ['network error', new TypeError('Failed to fetch')],
    ['5xx', httpError(503)],
  ])('fails closed on a %s once the token has expired', async (_label, failure) => {
    session.establishSession(jwt(-1000), 'person@example.invalid')
    client.refresh.mockRejectedValue(failure)

    expect(await mod.refreshWebSession({ reason: 'boot' })).toBe(false)
    expect(session.getSessionSnapshot().signedIn).toBe(false)
  })

  it('keeps a still-valid token on a transient refresh failure', async () => {
    const token = jwt(4 * 60 * 1000)
    session.establishSession(token, 'person@example.invalid')
    client.refresh.mockRejectedValue(new TypeError('Failed to fetch'))

    expect(await mod.refreshWebSession({ triggerToken: token })).toBe(false)
    expect(session.getAccessToken()).toBe(token)
  })

  it('refreshes once on boot without a token and restores the session', async () => {
    const pending = deferred()
    client.refresh.mockReturnValue(pending.promise)

    const boot = mod.startWebSession()
    expect(mod.isBootRefreshPending()).toBe(true)
    pending.resolve({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })
    await boot

    expect(client.refresh).toHaveBeenCalledOnce()
    expect(mod.isBootRefreshPending()).toBe(false)
    expect(session.getSessionSnapshot()).toMatchObject({ signedIn: true, email: 'person@example.invalid' })
  })

  it('shows the signed-out state after a boot refresh 401 without broadcasting', async () => {
    client.refresh.mockRejectedValue(httpError(401, { code: 'session_invalid' }))

    await mod.startWebSession()

    expect(session.getSessionSnapshot().signedIn).toBe(false)
    expect(mod.isBootRefreshPending()).toBe(false)
    expect(posted).toEqual([])
  })

  it('keeps a legacy 2-hour token working until a refresh finds no session', async () => {
    const legacy = jwt(HOUR)
    localStorage.setItem('token', legacy)
    localStorage.setItem('email', 'person@example.invalid')

    await mod.startWebSession()
    expect(client.refresh).not.toHaveBeenCalled()
    expect(session.getAccessToken()).toBe(legacy)

    client.refresh.mockRejectedValue(httpError(401, { code: 'session_invalid' }))
    expect(await mod.refreshWebSession({ triggerToken: legacy, reason: 'unauthorized' })).toBe(false)
    expect(session.getSessionSnapshot().signedIn).toBe(false)
  })

  it('schedules a refresh about five minutes before expiry', async () => {
    vi.useFakeTimers()
    const token = jwt(10 * 60 * 1000)
    localStorage.setItem('token', token)
    localStorage.setItem('email', 'person@example.invalid')
    client.refresh.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })

    await mod.startWebSession()
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    expect(client.refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(client.refresh).toHaveBeenCalledOnce()
    expect(session.getAccessToken()).not.toBe(token)
  })

  it('never schedules a refresh sooner than the floor, even for an expiring token', async () => {
    vi.useFakeTimers()
    localStorage.setItem('token', jwt(30 * 1000))
    localStorage.setItem('email', 'person@example.invalid')
    client.refresh.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })

    await mod.startWebSession()
    await vi.advanceTimersByTimeAsync(mod.MIN_REFRESH_INTERVAL_MS - 1000)
    expect(client.refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(client.refresh).toHaveBeenCalledOnce()
  })

  it('does not spin on refreshes when a skewed clock makes every new token look nearly expired', async () => {
    vi.useFakeTimers()
    localStorage.setItem('token', jwt(60 * 1000))
    localStorage.setItem('email', 'person@example.invalid')
    // Every token received looks like it expires in 2 minutes.
    client.refresh.mockImplementation(async () => ({ status: 200, data: { token: jwt(2 * 60 * 1000), email: 'person@example.invalid' } }))

    await mod.startWebSession()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(client.refresh.mock.calls.length).toBeGreaterThan(0)
    expect(client.refresh.mock.calls.length).toBeLessThanOrEqual(10)
    expect(session.getAccessToken()).toBeTruthy()
  })

  it('signs out on the server, clears storage and signs out other tabs', async () => {
    session.establishSession(jwt(HOUR), 'person@example.invalid')
    client.signOut.mockResolvedValue({ status: 204, data: '' })

    await mod.signOut()

    expect(client.signOut).toHaveBeenCalledOnce()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
    expect(localStorage.getItem('pending-sign-out')).toBeNull()
    expect(posted).toEqual([{ name: 'ordo-session', message: { type: 'signed-out' } }])
  })

  it('keeps a pending sign-out when the request fails and retries it on the next boot before any refresh', async () => {
    session.establishSession(jwt(HOUR), 'person@example.invalid')
    client.signOut.mockRejectedValue(new TypeError('Failed to fetch'))

    await mod.signOut()
    expect(localStorage.getItem('pending-sign-out')).toBe('1')
    expect(session.getSessionSnapshot().signedIn).toBe(false)
    expect(await mod.refreshWebSession()).toBe(false)
    expect(client.refresh).not.toHaveBeenCalled()

    await load()
    client.signOut.mockRejectedValue(new TypeError('Failed to fetch'))
    await mod.startWebSession()
    expect(client.signOut).toHaveBeenCalledOnce()
    expect(client.refresh).not.toHaveBeenCalled()
    expect(localStorage.getItem('pending-sign-out')).toBe('1')

    await load()
    client.signOut.mockResolvedValue({ status: 204, data: '' })
    await mod.startWebSession()
    expect(localStorage.getItem('pending-sign-out')).toBeNull()
    expect(client.refresh).not.toHaveBeenCalled()
  })

  it('signs out this tab when another tab broadcasts signed-out', async () => {
    client.refresh.mockRejectedValue(httpError(401, { code: 'session_invalid' }))
    await mod.startWebSession()
    session.establishSession(jwt(HOUR), 'person@example.invalid')

    FakeChannel.instances[0].listeners.forEach((listener) => listener({ data: { type: 'signed-out' } }))

    expect(session.getSessionSnapshot().signedIn).toBe(false)
  })

  it('signs in under the lock, establishes a new session and clears a pending sign-out', async () => {
    localStorage.setItem('pending-sign-out', '1')
    const request = vi.fn(async (_name, task) => task())
    vi.stubGlobal('navigator', { locks: { request } })
    client.signIn.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })

    await mod.signIn({ email: 'person@example.invalid', password: 'Synthetic1!' })

    expect(request).toHaveBeenCalledWith('ordo-web-session-refresh', expect.any(Function))
    expect(client.signIn).toHaveBeenCalledWith({ email: 'person@example.invalid', password: 'Synthetic1!' })
    expect(localStorage.getItem('pending-sign-out')).toBeNull()
    expect(session.getSessionSnapshot()).toMatchObject({ signedIn: true, email: 'person@example.invalid' })
  })
})
