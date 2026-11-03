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

function seedIdentity(id = 'stored-sign-in', email = 'person@example.invalid') {
  localStorage.setItem('sessionId', id)
  localStorage.setItem('email', email)
}

// Every key and value in both storages, to prove the token is not there.
function storageDump() {
  return [localStorage, sessionStorage]
    .flatMap((area) => Array.from({ length: area.length }, (_, index) => [area.key(index), area.getItem(area.key(index))]))
    .flat()
    .join('\n')
}

async function load() {
  vi.clearAllMocks()
  vi.resetModules()
  mod = await import('./webSession')
  session = await import('./session')
  client = (await import('../api/webSessionClient')).webSessionClient
}

// Each test loads fresh modules, which leave their window listeners behind. Remove
// them so an earlier test's module cannot react to a later test's storage events.
const storageListeners = []

describe('web-session orchestration', () => {
  beforeEach(async () => {
    const addEventListener = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'storage') storageListeners.push(listener)
      return addEventListener(type, listener, options)
    })
    localStorage.clear()
    sessionStorage.clear()
    posted.length = 0
    FakeChannel.instances = []
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    await load()
  })

  afterEach(() => {
    storageListeners.splice(0).forEach((listener) => window.removeEventListener('storage', listener))
    vi.restoreAllMocks()
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

  it('refreshes under the cross-tab lock and skips when this tab already replaced its token', async () => {
    const triggerToken = jwt(60 * 1000)
    session.establishSession(triggerToken, 'person@example.invalid')
    const request = vi.fn(async (name, task) => {
      // This tab's own token was replaced while it waited for the lock.
      session.replaceAccessToken(jwt(2 * HOUR), 'person@example.invalid')
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

  it('deletes a legacy stored token on boot, never uses it and refreshes through the cookie', async () => {
    const legacy = jwt(HOUR)
    localStorage.setItem('token', legacy)
    localStorage.setItem('email', 'person@example.invalid')
    localStorage.setItem('sessionId', 'stored-sign-in')
    const fresh = jwt(2 * HOUR)
    client.refresh.mockResolvedValue({ status: 200, data: { token: fresh, email: 'person@example.invalid' } })

    expect(session.getAccessToken()).toBeNull()
    await mod.startWebSession()

    expect(localStorage.getItem('token')).toBeNull()
    expect(client.refresh).toHaveBeenCalledOnce()
    expect(session.getAccessToken()).toBe(fresh)
  })

  it('schedules a refresh about five minutes before expiry', async () => {
    vi.useFakeTimers()
    const token = jwt(10 * 60 * 1000)
    client.refresh.mockResolvedValueOnce({ status: 200, data: { token, email: 'person@example.invalid' } })
    client.refresh.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })

    await mod.startWebSession()
    expect(client.refresh).toHaveBeenCalledOnce()
    expect(session.getAccessToken()).toBe(token)
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    expect(client.refresh).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(client.refresh).toHaveBeenCalledTimes(2)
    expect(session.getAccessToken()).not.toBe(token)
  })

  it('never schedules a refresh sooner than the floor, even for an expiring token', async () => {
    vi.useFakeTimers()
    client.refresh.mockResolvedValueOnce({ status: 200, data: { token: jwt(30 * 1000), email: 'person@example.invalid' } })
    client.refresh.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })

    await mod.startWebSession()
    expect(client.refresh).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(mod.MIN_REFRESH_INTERVAL_MS - 1000)
    expect(client.refresh).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2000)
    expect(client.refresh).toHaveBeenCalledTimes(2)
  })

  it('does not spin on refreshes when a skewed clock makes every new token look nearly expired', async () => {
    vi.useFakeTimers()
    // Every token received looks like it expires in 2 minutes.
    client.refresh.mockImplementation(async () => ({ status: 200, data: { token: jwt(2 * 60 * 1000), email: 'person@example.invalid' } }))

    await mod.startWebSession()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(client.refresh.mock.calls.length).toBeGreaterThan(0)
    expect(client.refresh.mock.calls.length).toBeLessThanOrEqual(11)
    expect(session.getAccessToken()).toBeTruthy()
  })

  it('signs out on the server, clears storage and signs out other tabs', async () => {
    session.establishSession(jwt(HOUR), 'person@example.invalid')
    client.signOut.mockResolvedValue({ status: 204, data: '' })

    await mod.signOut()

    expect(client.signOut).toHaveBeenCalledOnce()
    expect(session.getAccessToken()).toBeNull()
    expect(localStorage.getItem('sessionId')).toBeNull()
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

  it('keeps the access token out of every storage after sign-in and refresh', async () => {
    client.signIn.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })
    await mod.signIn({ email: 'person@example.invalid', password: 'Synthetic1!' })
    const signedIn = session.getAccessToken()
    expect(storageDump()).not.toContain(signedIn)

    const next = jwt(3 * HOUR)
    client.refresh.mockResolvedValue({ status: 200, data: { token: next, email: 'person@example.invalid' } })
    expect(await mod.refreshWebSession({ reason: 'unauthorized' })).toBe(true)
    expect(session.getAccessToken()).toBe(next)
    expect(storageDump()).not.toContain(next)
    expect(storageDump()).not.toContain(signedIn)
    expect(Object.keys(localStorage).sort()).toEqual(['email', 'sessionId'])
    expect(sessionStorage.length).toBe(0)
  })

  it('adopts the stored identity on boot without writing storage, so other tabs are undisturbed', async () => {
    seedIdentity('stored-sign-in')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    client.refresh.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })

    await mod.startWebSession()

    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem.mock.calls).toEqual([['token']])
    expect(session.getSessionSnapshot()).toMatchObject({ signedIn: true, id: 'stored-sign-in', email: 'person@example.invalid' })
    expect(localStorage.getItem('sessionId')).toBe('stored-sign-in')
    expect(posted).toEqual([])
    setItem.mockRestore()
    removeItem.mockRestore()
  })

  describe('boot loading state', () => {
    beforeEach(() => vi.useFakeTimers())

    it('never falls back to sign-in while a stored identity waits on a slow refresh, then signs in on a late answer', async () => {
      seedIdentity()
      const pending = deferred()
      client.refresh.mockReturnValue(pending.promise)
      const changes = vi.fn()
      mod.subscribeToBootRefresh(changes)

      void mod.startWebSession()
      expect(mod.getBootStatus()).toEqual({ pending: true, slow: false, unreachable: false })

      await vi.advanceTimersByTimeAsync(4100)
      expect(mod.getBootStatus()).toEqual({ pending: true, slow: true, unreachable: false })
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(mod.isBootRefreshPending()).toBe(true)
      expect(session.getSessionSnapshot().signedIn).toBe(false)
      expect(localStorage.getItem('sessionId')).toBe('stored-sign-in')

      pending.resolve({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })
      await vi.advanceTimersByTimeAsync(0)

      expect(mod.getBootStatus()).toEqual({ pending: false, slow: false, unreachable: false })
      expect(session.getSessionSnapshot()).toMatchObject({ signedIn: true, id: 'stored-sign-in' })
      expect(client.refresh).toHaveBeenCalledOnce()
      expect(changes).toHaveBeenCalled()
    })

    it('stops waiting after 4 seconds when no identity is stored, and a late refresh still signs in', async () => {
      const pending = deferred()
      client.refresh.mockReturnValue(pending.promise)

      void mod.startWebSession()
      expect(mod.isBootRefreshPending()).toBe(true)
      await vi.advanceTimersByTimeAsync(4100)
      expect(mod.isBootRefreshPending()).toBe(false)

      pending.resolve({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })
      await vi.advanceTimersByTimeAsync(0)
      expect(session.getSessionSnapshot()).toMatchObject({ signedIn: true, email: 'person@example.invalid' })
    })

    it.each([
      ['network error', () => new TypeError('Failed to fetch')],
      ['5xx', () => httpError(503)],
    ])('keeps loading and retries with a growing delay after a %s while an identity is stored', async (_label, failure) => {
      seedIdentity()
      client.refresh.mockRejectedValue(failure())

      void mod.startWebSession()
      await vi.advanceTimersByTimeAsync(0)
      expect(client.refresh).toHaveBeenCalledTimes(1)
      expect(mod.getBootStatus()).toMatchObject({ pending: true, unreachable: true })
      expect(session.getSessionSnapshot().signedIn).toBe(false)
      expect(localStorage.getItem('sessionId')).toBe('stored-sign-in')

      await vi.advanceTimersByTimeAsync(4900)
      expect(client.refresh).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(200)
      expect(client.refresh).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(9800)
      expect(client.refresh).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(400)
      expect(client.refresh).toHaveBeenCalledTimes(3)
      expect(mod.getBootStatus()).toMatchObject({ pending: true, unreachable: true })

      client.refresh.mockResolvedValue({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })
      await vi.advanceTimersByTimeAsync(20 * 1000)

      expect(client.refresh).toHaveBeenCalledTimes(4)
      expect(mod.getBootStatus()).toEqual({ pending: false, slow: false, unreachable: false })
      expect(session.getSessionSnapshot()).toMatchObject({ signedIn: true, id: 'stored-sign-in' })
    })

    it('does not retry a boot network error when no identity is stored', async () => {
      client.refresh.mockRejectedValue(new TypeError('Failed to fetch'))

      await mod.startWebSession()
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      expect(client.refresh).toHaveBeenCalledOnce()
      expect(mod.isBootRefreshPending()).toBe(false)
      expect(session.getSessionSnapshot().signedIn).toBe(false)
    })

    it('ends the stored sign-in, signs out other tabs and shows sign-in when the boot refresh returns 401', async () => {
      seedIdentity()
      client.refresh.mockRejectedValue(httpError(401, { code: 'session_invalid' }))

      await mod.startWebSession()
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      expect(client.refresh).toHaveBeenCalledOnce()
      expect(mod.isBootRefreshPending()).toBe(false)
      expect(localStorage.getItem('sessionId')).toBeNull()
      expect(localStorage.getItem('email')).toBeNull()
      expect(posted).toEqual([{ name: 'ordo-session', message: { type: 'signed-out' } }])
    })

    it('shows sign-in without retrying when the boot refresh is refused for a reason retrying cannot fix', async () => {
      seedIdentity()
      client.refresh.mockRejectedValue(httpError(403))

      await mod.startWebSession()
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      expect(client.refresh).toHaveBeenCalledOnce()
      expect(mod.isBootRefreshPending()).toBe(false)
      expect(localStorage.getItem('sessionId')).toBeNull()
    })

    it('does not show loading or refresh while a sign-out is pending', async () => {
      seedIdentity()
      localStorage.setItem('pending-sign-out', '1')
      client.signOut.mockResolvedValue({ status: 204, data: '' })

      await mod.startWebSession()

      expect(client.refresh).not.toHaveBeenCalled()
      expect(mod.isBootRefreshPending()).toBe(false)
    })

    it('drops its token and refreshes when another tab signs in, adopting the new identity', async () => {
      client.refresh.mockRejectedValueOnce(httpError(401, { code: 'session_invalid' }))
      await mod.startWebSession()
      session.establishSession(jwt(HOUR), 'old@example.invalid')
      const next = jwt(2 * HOUR)
      client.refresh.mockResolvedValue({ status: 200, data: { token: next, email: 'new@example.invalid' } })
      const setItem = vi.spyOn(Storage.prototype, 'setItem')

      // Another tab signed in: it wrote a new identity, which ended this tab's session.
      localStorage.setItem('sessionId', 'other-tab-sign-in')
      localStorage.setItem('email', 'new@example.invalid')
      setItem.mockClear()
      window.dispatchEvent(new StorageEvent('storage', { key: 'sessionId', storageArea: localStorage }))
      expect(session.getSessionSnapshot().signedIn).toBe(false)
      expect(mod.getBootStatus()).toMatchObject({ pending: true })
      await vi.advanceTimersByTimeAsync(0)

      expect(client.refresh).toHaveBeenCalledTimes(2)
      expect(session.getAccessToken()).toBe(next)
      expect(session.getSessionSnapshot()).toMatchObject({ signedIn: true, id: 'other-tab-sign-in', email: 'new@example.invalid' })
      expect(setItem).not.toHaveBeenCalled()
      expect(mod.isBootRefreshPending()).toBe(false)
      setItem.mockRestore()
    })

    it('drops its token without refreshing when another tab signs out', async () => {
      client.refresh.mockRejectedValueOnce(httpError(401, { code: 'session_invalid' }))
      await mod.startWebSession()
      session.establishSession(jwt(HOUR), 'person@example.invalid')

      localStorage.removeItem('sessionId')
      localStorage.removeItem('email')
      window.dispatchEvent(new StorageEvent('storage', { key: 'sessionId', storageArea: localStorage }))
      await vi.advanceTimersByTimeAsync(60 * 1000)

      expect(session.getSessionSnapshot().signedIn).toBe(false)
      expect(session.getAccessToken()).toBeNull()
      expect(client.refresh).toHaveBeenCalledOnce()
      expect(mod.isBootRefreshPending()).toBe(false)
    })

    it('discards a refresh answer that arrives after another tab signed out', async () => {
      seedIdentity()
      const pending = deferred()
      client.refresh.mockReturnValue(pending.promise)
      void mod.startWebSession()
      await vi.advanceTimersByTimeAsync(0)

      localStorage.removeItem('sessionId')
      localStorage.removeItem('email')
      window.dispatchEvent(new StorageEvent('storage', { key: 'sessionId', storageArea: localStorage }))
      pending.resolve({ status: 200, data: { token: jwt(2 * HOUR), email: 'person@example.invalid' } })
      await vi.advanceTimersByTimeAsync(60 * 1000)

      expect(session.getSessionSnapshot().signedIn).toBe(false)
      expect(session.getAccessToken()).toBeNull()
      expect(localStorage.getItem('sessionId')).toBeNull()
      expect(mod.isBootRefreshPending()).toBe(false)
    })
  })
})
