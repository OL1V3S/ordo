import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, CanceledError } from 'axios'
import client from './client'
import { clearSession, establishSession, getSessionSnapshot, subscribeToSession } from '../auth/session'

function httpError(config, status = 401) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
    data: { message: 'Request failed' }, status, statusText: 'Error', headers: {}, config,
  })
}

function pendingRequest() {
  let fail
  let entered
  const started = new Promise((resolve) => { entered = resolve })
  const adapter = vi.fn((config) => new Promise((_resolve, reject) => {
    fail = () => reject(httpError(config))
    entered()
  }))
  const result = client.get('/api/expenses', { adapter }).catch((error) => error)
  return { started, result, adapter, reject: () => fail() }
}

describe('API authorization', () => {
  beforeEach(() => localStorage.clear())

  it('adds the stored token using the existing bearer request shape', async () => {
    localStorage.setItem('token', 'jwt-value')
    let requestConfig

    await client.get('/api/expenses', {
      adapter: async (config) => {
        requestConfig = config
        return {
          data: [],
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      },
    })

    expect(requestConfig.headers.Authorization).toBe('Bearer jwt-value')
  })

  it('does not add authorization when no token is stored', async () => {
    let requestConfig

    await client.get('/api/expenses', {
      adapter: async (config) => {
        requestConfig = config
        return {
          data: [],
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      },
    })

    expect(requestConfig.headers.Authorization).toBeUndefined()
  })
})

describe('authenticated response recovery', () => {
  const subscriptions = []

  beforeEach(() => {
    localStorage.clear()
    establishSession('current-token', 'person@example.com')
  })

  afterEach(() => subscriptions.splice(0).forEach((unsubscribe) => unsubscribe()))

  it.each(['get', 'post', 'put', 'patch', 'delete'])('invalidates a failed %s once and never replays the request', async (method) => {
    localStorage.setItem('budget-planner-theme', 'dark')
    const listener = vi.fn()
    subscriptions.push(subscribeToSession(listener))
    let originalError
    const adapter = vi.fn(async (config) => {
      originalError = httpError(config)
      throw originalError
    })

    const error = await client.request({ url: '/api/expenses', method, data: { amount: 10 }, adapter }).catch((failure) => failure)

    expect(error).toBe(originalError)
    expect(adapter).toHaveBeenCalledOnce()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
    expect(localStorage.getItem('budget-planner-theme')).toBe('dark')
    expect(listener).toHaveBeenCalledOnce()
  })

  it('makes simultaneous authenticated 401s idempotent', async () => {
    const listener = vi.fn()
    subscriptions.push(subscribeToSession(listener))
    const first = pendingRequest()
    const second = pendingRequest()
    await Promise.all([first.started, second.started])

    first.reject()
    second.reject()
    const results = await Promise.all([first.result, second.result])

    results.forEach((error) => expect(error.response.status).toBe(401))
    expect(listener).toHaveBeenCalledOnce()
    expect(localStorage.getItem('token')).toBeNull()
    expect(first.adapter).toHaveBeenCalledOnce()
    expect(second.adapter).toHaveBeenCalledOnce()
  })

  it.each(['logout', 'different-token', 'same-token'])('ignores an old 401 after %s', async (transition) => {
    const request = pendingRequest()
    await request.started
    clearSession()
    if (transition !== 'logout') {
      establishSession(transition === 'same-token' ? 'current-token' : 'new-token', 'new@example.com')
    }
    const current = getSessionSnapshot()
    const listener = vi.fn()
    subscriptions.push(subscribeToSession(listener))

    request.reject()
    expect((await request.result).response.status).toBe(401)

    expect(getSessionSnapshot()).toBe(current)
    expect(listener).not.toHaveBeenCalled()
    expect(request.adapter).toHaveBeenCalledOnce()
  })

  it('ignores an old-token 401 after a same-sign-in refresh and keeps the session', async () => {
    const before = getSessionSnapshot()
    const request = pendingRequest()
    await request.started
    localStorage.setItem('token', 'refreshed-token')

    request.reject()
    await request.result

    expect(localStorage.getItem('token')).toBe('refreshed-token')
    expect(getSessionSnapshot()).toBe(before)
  })

  it('invalidates on a 401 for the refreshed token of the same sign-in', async () => {
    localStorage.setItem('token', 'refreshed-token')
    const adapter = vi.fn(async (config) => { throw httpError(config) })

    await client.get('/api/expenses', { adapter }).catch(() => {})

    expect(localStorage.getItem('token')).toBeNull()
  })

  it('ignores an old 401 when another tab replaces storage before its event arrives', async () => {
    const request = pendingRequest()
    await request.started
    localStorage.setItem('token', 'other-tab-token')
    localStorage.setItem('email', 'new@example.com')

    request.reject()
    await request.result

    expect(localStorage.getItem('token')).toBe('other-tab-token')
    expect(localStorage.getItem('email')).toBe('new@example.com')
  })

  it.each([400, 403, 404, 429, 500])('preserves the session and original error for status %s', async (status) => {
    const current = getSessionSnapshot()
    let originalError
    const adapter = vi.fn(async (config) => {
      originalError = httpError(config, status)
      throw originalError
    })
    const error = await client.get('/api/expenses', { adapter }).catch((failure) => failure)

    expect(error).toBe(originalError)
    expect(getSessionSnapshot()).toBe(current)
    expect(adapter).toHaveBeenCalledOnce()
  })

  it.each(['network', 'cancellation'])('preserves the session on %s failure', async (kind) => {
    const current = getSessionSnapshot()
    let originalError
    const adapter = vi.fn(async (config) => {
      originalError = kind === 'network'
        ? new AxiosError('Network Error', 'ERR_NETWORK', config)
        : new CanceledError('Request canceled', config)
      throw originalError
    })
    const error = await client.get('/api/expenses', { adapter }).catch((failure) => failure)

    expect(error).toBe(originalError)
    expect(getSessionSnapshot()).toBe(current)
    expect(adapter).toHaveBeenCalledOnce()
  })

  it('does not invalidate for an unauthenticated request returning 401', async () => {
    clearSession()
    const request = pendingRequest()
    await request.started
    establishSession('later-token', 'person@example.com')
    const current = getSessionSnapshot()

    request.reject()
    await request.result

    expect(getSessionSnapshot()).toBe(current)
  })

  it('passes successful responses through without changing the session', async () => {
    const current = getSessionSnapshot()
    const data = { id: 123 }
    const response = await client.post('/api/expenses', { amount: 10 }, {
      adapter: async (config) => ({ data, status: 201, statusText: 'Created', headers: {}, config }),
    })

    expect(response.data).toBe(data)
    expect(response.status).toBe(201)
    expect(getSessionSnapshot()).toBe(current)
  })
})
