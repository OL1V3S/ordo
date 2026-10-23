import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSession, establishSession, getAccessToken, getSessionSnapshot, invalidateSession, subscribeToSession } from './session'

const subscriptions = []

function subscribe(listener = vi.fn()) {
  const unsubscribe = subscribeToSession(listener)
  subscriptions.push(unsubscribe)
  return { listener, unsubscribe }
}

function storageEvent(key, storageArea = localStorage, newValue = null) {
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea, newValue }))
}

describe('shared authentication session', () => {
  beforeEach(() => {
    localStorage.clear()
    getSessionSnapshot()
  })

  afterEach(() => subscriptions.splice(0).forEach((unsubscribe) => unsubscribe()))

  it('reads existing keys and returns the same snapshot while values are unchanged', () => {
    localStorage.setItem('token', 'stored-token')
    localStorage.setItem('email', 'person@example.com')
    const session = getSessionSnapshot()

    expect(session).toMatchObject({ signedIn: true, email: 'person@example.com' })
    expect(session).not.toHaveProperty('token')
    expect(getAccessToken()).toBe('stored-token')
    expect(session.id).toBe(localStorage.getItem('sessionId'))
    expect(getSessionSnapshot()).toBe(session)
  })

  it('establishes and clears a session without changing unrelated storage', () => {
    localStorage.setItem('budget-planner-theme', 'dark')
    const { listener } = subscribe()
    establishSession('new-token', 'person@example.com')

    expect(getSessionSnapshot()).toMatchObject({ signedIn: true, email: 'person@example.com' })
    expect(localStorage.getItem('token')).toBe('new-token')
    expect(localStorage.getItem('email')).toBe('person@example.com')
    expect(listener).toHaveBeenCalledTimes(1)

    clearSession()

    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: null })
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
    expect(localStorage.getItem('budget-planner-theme')).toBe('dark')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls).toEqual([[], []])
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
    expect(localStorage.getItem('token')).toBe('same-token')
  })

  it('reconciles a different token before a queued storage event arrives', () => {
    establishSession('old-token', 'old@example.com')
    const oldSession = getSessionSnapshot()
    localStorage.setItem('token', 'other-tab-token')
    localStorage.setItem('email', 'new@example.com')
    localStorage.setItem('sessionId', 'other-tab-sign-in')

    expect(invalidateSession(oldSession, 'old-token')).toBe(false)
    expect(getSessionSnapshot()).toMatchObject({ signedIn: true, id: 'other-tab-sign-in', email: 'new@example.com' })
  })

  it('observes other-tab logout and email changes with stable snapshots', () => {
    establishSession('stored-token', 'old@example.com')
    const { listener } = subscribe()
    const previous = getSessionSnapshot()
    localStorage.setItem('email', 'new@example.com')
    storageEvent('email', localStorage, 'new@example.com')

    expect(getSessionSnapshot()).toMatchObject({ signedIn: true, email: 'new@example.com', generation: previous.generation })
    expect(getSessionSnapshot()).not.toBe(previous)
    expect(getSessionSnapshot()).toBe(getSessionSnapshot())

    localStorage.removeItem('token')
    localStorage.removeItem('email')
    storageEvent('token')
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: null })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('handles localStorage clear without reacting to unrelated storage events', () => {
    establishSession('stored-token', 'person@example.com')
    const { listener } = subscribe()
    storageEvent('budget-planner-theme')
    storageEvent('token', sessionStorage)
    expect(listener).not.toHaveBeenCalled()

    localStorage.clear()
    storageEvent(null)
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: null })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('does not replay stale event values or advance an already reconciled generation', () => {
    establishSession('old-token', 'old@example.com')
    localStorage.setItem('token', 'new-token')
    localStorage.setItem('email', 'new@example.com')
    localStorage.setItem('sessionId', 'new-sign-in')
    const current = getSessionSnapshot()
    const { listener } = subscribe()
    storageEvent('token', localStorage, 'old-token')

    expect(getSessionSnapshot()).toBe(current)
    expect(listener).toHaveBeenCalledOnce()
    expect(invalidateSession(current, getAccessToken())).toBe(true)
  })

  it('cleans up listeners and reads invalidation that happened before subscribing', () => {
    establishSession('old-token', 'person@example.com')
    const { listener, unsubscribe } = subscribe()
    unsubscribe()
    clearSession()
    storageEvent('token')
    expect(listener).not.toHaveBeenCalled()

    const next = subscribe()
    expect(getSessionSnapshot()).toMatchObject({ signedIn: false, id: null, email: null })
    establishSession('new-token', 'person@example.com')
    expect(next.listener).toHaveBeenCalledOnce()
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps identity and generation when only the access token changes', () => {
    establishSession('first-token', 'person@example.com')
    const before = getSessionSnapshot()
    const { listener } = subscribe()

    localStorage.setItem('token', 'refreshed-token')
    storageEvent('token', localStorage, 'refreshed-token')

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

  it('assigns an id to a legacy token that has none and keeps it stable', () => {
    localStorage.setItem('token', 'legacy-token')
    const session = getSessionSnapshot()
    expect(session.id).toMatch(/^[0-9a-f]{32}$/)
    expect(getSessionSnapshot()).toBe(session)
  })
})
