import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRequestReference, getRequestReference, reportServerError } from '../api/requestReference'
import {
  adoptAccessToken,
  clearSession,
  establishSession,
  getAccessToken,
  getSessionSnapshot,
  getStoredSessionId,
  invalidateSession,
  removeLegacyAccessToken,
  replaceAccessToken,
  subscribeToSession,
} from './session'

const subscriptions = []

function subscribe(listener = vi.fn()) {
  const unsubscribe = subscribeToSession(listener)
  subscriptions.push(unsubscribe)
  return { listener, unsubscribe }
}

function storageEvent(key, storageArea = localStorage, newValue = null) {
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea, newValue }))
}

function storageHolds(secret) {
  return [localStorage, sessionStorage].some((area) =>
    Array.from({ length: area.length }, (_, index) => area.key(index)).some((key) => key.includes(secret) || area.getItem(key).includes(secret)))
}

describe('shared authentication session', () => {
  beforeEach(() => {
    clearSession()
    localStorage.clear()
    sessionStorage.clear()
    getSessionSnapshot()
    clearRequestReference()
  })

  afterEach(() => {
    subscriptions.splice(0).forEach((unsubscribe) => unsubscribe())
    vi.restoreAllMocks()
  })

  it('holds the access token in memory only, never in storage', () => {
    establishSession('secret-access-token', 'person@example.com')
    const session = getSessionSnapshot()

    expect(session).toMatchObject({ signedIn: true, email: 'person@example.com' })
    expect(session).not.toHaveProperty('token')
    expect(getAccessToken()).toBe('secret-access-token')
    expect(session.id).toBe(localStorage.getItem('sessionId'))
    expect(getSessionSnapshot()).toBe(session)
    expect(localStorage.getItem('token')).toBeNull()
    expect(storageHolds('secret-access-token')).toBe(false)

    replaceAccessToken('secret-refreshed-token', 'person@example.com')
    expect(getAccessToken()).toBe('secret-refreshed-token')
    expect(storageHolds('secret-refreshed-token')).toBe(false)
    expect(Object.keys(localStorage).sort()).toEqual(['email', 'sessionId'])
    expect(sessionStorage.length).toBe(0)
  })

  it('never reads a legacy stored token as a credential and removes it on request', () => {
    localStorage.setItem('token', 'legacy-stored-token')
    localStorage.setItem('email', 'person@example.com')
    localStorage.setItem('sessionId', 'stored-sign-in')

    expect(getAccessToken()).toBeNull()
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null })

    removeLegacyAccessToken()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('sessionId')).toBe('stored-sign-in')
  })

  it('establishes and clears a session without changing unrelated storage', () => {
    localStorage.setItem('budget-planner-theme', 'dark')
    const { listener } = subscribe()
    establishSession('new-token', 'person@example.com')

    expect(getSessionSnapshot()).toMatchObject({ signedIn: true, email: 'person@example.com' })
    expect(localStorage.getItem('email')).toBe('person@example.com')
    expect(listener).toHaveBeenCalledTimes(1)

    clearSession()

    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: null })
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('sessionId')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
    expect(localStorage.getItem('budget-planner-theme')).toBe('dark')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls).toEqual([[], []])
  })

  it('removes a legacy token key when establishing or clearing', () => {
    localStorage.setItem('token', 'legacy-stored-token')
    establishSession('new-token', 'person@example.com')
    expect(localStorage.getItem('token')).toBeNull()

    localStorage.setItem('token', 'legacy-stored-token')
    clearSession()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('invalidates the matching session only once', () => {
    establishSession('old-token', 'person@example.com')
    const requestSession = getSessionSnapshot()
    const { listener } = subscribe()

    expect(invalidateSession(requestSession, getAccessToken())).toBe(true)
    expect(invalidateSession(requestSession, getAccessToken())).toBe(false)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('rejects stale invalidation after establishing the same token again', () => {
    establishSession('same-token', 'person@example.com')
    const oldSession = getSessionSnapshot()
    establishSession('same-token', 'person@example.com')

    expect(getSessionSnapshot().generation).not.toBe(oldSession.generation)
    expect(invalidateSession(oldSession, 'same-token')).toBe(false)
    expect(getAccessToken()).toBe('same-token')
  })

  it('drops its token when another tab signed in, before the storage event arrives', () => {
    establishSession('old-token', 'old@example.com')
    const oldSession = getSessionSnapshot()
    localStorage.setItem('email', 'new@example.com')
    localStorage.setItem('sessionId', 'other-tab-sign-in')

    // A stale 401 for the replaced sign-in must not clear the other tab's identity.
    expect(invalidateSession(oldSession, 'old-token')).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: 'new@example.com' })
    expect(localStorage.getItem('sessionId')).toBe('other-tab-sign-in')
    expect(localStorage.getItem('email')).toBe('new@example.com')
  })

  it('observes other-tab email changes with stable snapshots and other-tab sign-out', () => {
    establishSession('stored-token', 'old@example.com')
    const { listener } = subscribe()
    const previous = getSessionSnapshot()
    localStorage.setItem('email', 'new@example.com')
    storageEvent('email', localStorage, 'new@example.com')

    expect(getSessionSnapshot()).toMatchObject({ signedIn: true, email: 'new@example.com', generation: previous.generation })
    expect(getSessionSnapshot()).not.toBe(previous)
    expect(getSessionSnapshot()).toBe(getSessionSnapshot())

    localStorage.removeItem('sessionId')
    localStorage.removeItem('email')
    storageEvent('sessionId')
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: null })
    expect(getAccessToken()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('handles localStorage clear and ignores unrelated and legacy-token storage events', () => {
    establishSession('stored-token', 'person@example.com')
    const { listener } = subscribe()
    storageEvent('budget-planner-theme')
    storageEvent('sessionId', sessionStorage)
    storageEvent('token')
    storageEvent('token', localStorage, 'legacy-stored-token')
    expect(listener).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('stored-token')

    localStorage.clear()
    storageEvent(null)
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: null })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('does not replay stale event values or advance an already reconciled generation', () => {
    establishSession('old-token', 'old@example.com')
    localStorage.setItem('email', 'new@example.com')
    localStorage.setItem('sessionId', 'new-sign-in')
    const current = getSessionSnapshot()
    const { listener } = subscribe()
    storageEvent('sessionId', localStorage, 'old-sign-in')

    expect(getSessionSnapshot()).toBe(current)
    expect(listener).toHaveBeenCalledOnce()
    expect(invalidateSession(current, getAccessToken())).toBe(false)
  })

  it('cleans up listeners and reads invalidation that happened before subscribing', () => {
    establishSession('old-token', 'person@example.com')
    const { listener, unsubscribe } = subscribe()
    unsubscribe()
    clearSession()
    storageEvent('sessionId')
    expect(listener).not.toHaveBeenCalled()

    const next = subscribe()
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: null })
    establishSession('new-token', 'person@example.com')
    expect(next.listener).toHaveBeenCalledOnce()
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps identity and generation, and writes nothing, when only the access token changes', () => {
    establishSession('first-token', 'person@example.com')
    const before = getSessionSnapshot()
    const { listener } = subscribe()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    replaceAccessToken('refreshed-token', 'person@example.com')

    expect(setItem).not.toHaveBeenCalled()
    expect(getSessionSnapshot()).toBe(before)
    expect(getAccessToken()).toBe('refreshed-token')
    expect(listener).toHaveBeenCalledOnce()
    expect(invalidateSession(before, 'first-token')).toBe(false)
    expect(getSessionSnapshot()).toBe(before)
    expect(invalidateSession(before, 'refreshed-token')).toBe(true)
  })

  it('mints a fresh id and generation on every sign-in and clears them on sign-out', () => {
    establishSession('same-token', 'person@example.com')
    const first = getSessionSnapshot()
    establishSession('same-token', 'person@example.com')
    const second = getSessionSnapshot()
    expect(second.id).not.toBe(first.id)
    expect(second.generation).toBeGreaterThan(first.generation)
    expect(second.id).toMatch(/^[0-9a-f]{32}$/)

    clearSession()
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null })
    expect(localStorage.getItem('sessionId')).toBeNull()
  })

  it('adopts a stored identity on reload without any storage write', () => {
    localStorage.setItem('sessionId', 'stored-sign-in')
    localStorage.setItem('email', 'person@example.com')
    const { listener } = subscribe()
    const before = getSessionSnapshot()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')

    expect(before).toMatchObject({ signedIn: false, id: null })
    adoptAccessToken('boot-token', 'person@example.com')

    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('boot-token')
    expect(getSessionSnapshot()).toMatchObject({ signedIn: true, id: 'stored-sign-in', email: 'person@example.com' })
    expect(getSessionSnapshot().generation).toBeGreaterThan(before.generation)
    expect(localStorage.getItem('sessionId')).toBe('stored-sign-in')
    expect(listener).toHaveBeenCalledOnce()
  })

  it('establishes a new identity when the cookie outlived storage', () => {
    adoptAccessToken('boot-token', 'person@example.com')

    const session = getSessionSnapshot()
    expect(session).toMatchObject({ signedIn: true, email: 'person@example.com' })
    expect(session.id).toMatch(/^[0-9a-f]{32}$/)
    expect(getStoredSessionId()).toBe(session.id)
  })

  it('writes sessionId before email when establishing and never writes a token key', () => {
    const keys = []
    const realSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      keys.push(key)
      return realSet.call(this, key, value)
    })
    establishSession('t', 'a@b.c')
    expect(keys).toEqual(['sessionId', 'email'])
  })

  it('stays signed in with a stable id when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    establishSession('memory-token', 'person@example.com')

    const session = getSessionSnapshot()
    expect(session.signedIn).toBe(true)
    expect(session.id).toMatch(/^[0-9a-f]{32}$/)
    expect(getAccessToken()).toBe('memory-token')
    expect(getSessionSnapshot()).toBe(session)
  })

  describe('support request reference (#340)', () => {
    const raise = () => reportServerError({ status: 500, data: { requestId: 'req-1234abcd' } })

    it('clears the reference when another tab signs in as a new session', () => {
      establishSession('old-token', 'old@example.com')
      const { listener } = subscribe()
      raise()
      expect(getRequestReference()).toBe('req-1234abcd')

      localStorage.setItem('sessionId', 'other-tab-sign-in')
      storageEvent('sessionId', localStorage, 'other-tab-sign-in')

      expect(getRequestReference()).toBeNull()
      expect(listener).toHaveBeenCalled()
    })

    it('clears the reference when another tab signs out', () => {
      establishSession('old-token', 'old@example.com')
      subscribe()
      raise()

      localStorage.removeItem('sessionId')
      localStorage.removeItem('email')
      storageEvent('sessionId')

      expect(getRequestReference()).toBeNull()
    })

    it('does not clear the reference while reading a snapshot, only when the storage event arrives', () => {
      establishSession('old-token', 'old@example.com')
      subscribe()
      raise()

      // Another tab signed in; a render or request reads the snapshot first.
      localStorage.setItem('sessionId', 'other-tab-sign-in')
      expect(getSessionSnapshot()).toMatchObject({ signedIn: false })
      expect(getRequestReference()).toBe('req-1234abcd')

      storageEvent('sessionId', localStorage, 'other-tab-sign-in')
      expect(getRequestReference()).toBeNull()
    })

    it('clears the reference when this tab adopts a token before the storage event of another tab sign-in', () => {
      establishSession('old-token', 'old@example.com')
      raise()
      expect(getRequestReference()).toBe('req-1234abcd')

      // Another tab signed in; this tab's storage event has not arrived yet.
      localStorage.setItem('sessionId', 'other-tab-sign-in')
      localStorage.setItem('email', 'new@example.com')
      adoptAccessToken('new-token', 'new@example.com')

      expect(getSessionSnapshot()).toMatchObject({ signedIn: true, id: 'other-tab-sign-in' })
      expect(getRequestReference()).toBeNull()
    })

    it('keeps the reference for an email-only change or unrelated storage events', () => {
      establishSession('old-token', 'old@example.com')
      subscribe()
      raise()

      localStorage.setItem('email', 'new@example.com')
      storageEvent('email', localStorage, 'new@example.com')
      storageEvent('budget-planner-theme')
      replaceAccessToken('refreshed-token', 'new@example.com')

      expect(getRequestReference()).toBe('req-1234abcd')
    })

    it('still clears on this tab signing in or out', () => {
      establishSession('first', 'a@example.com')
      raise()
      establishSession('second', 'a@example.com')
      expect(getRequestReference()).toBeNull()

      raise()
      clearSession()
      expect(getRequestReference()).toBeNull()
    })
  })
})
