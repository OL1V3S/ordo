import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webSessionClient } from './webSessionClient'
import { clearRequestReference, getRequestReference } from './requestReference'

function stubFetch(status, body, contentType = 'application/json; charset=utf-8') {
  const fetch = vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': contentType } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('web-session client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('signs in same-origin with the CSRF header and no abort signal', async () => {
    const fetch = stubFetch(200, JSON.stringify({ token: 'jwt', email: 'person@example.invalid' }))

    const response = await webSessionClient.signIn({ email: 'person@example.invalid', password: 'Synthetic1!' })

    expect(response.data).toEqual({ token: 'jwt', email: 'person@example.invalid' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/auth/web-session')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers['X-Ordo-Web-Session']).toBe('1')
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.signal).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ email: 'person@example.invalid', password: 'Synthetic1!' })
  })

  it.each([
    ['refresh', '/api/auth/web-session/refresh'],
    ['signOut', '/api/auth/web-session/sign-out'],
  ])('sends %s without a body to the relative path', async (method, path) => {
    const fetch = stubFetch(method === 'signOut' ? 204 : 200, method === 'signOut' ? null : '{"token":"t","email":"e"}')

    await webSessionClient[method]()

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(path)
    expect(init.body).toBeUndefined()
    expect(init.credentials).toBe('same-origin')
    expect(init.headers['X-Ordo-Web-Session']).toBe('1')
    expect(init.signal).toBeUndefined()
  })

  it('rejects with the same plain-string error shape as login', async () => {
    stubFetch(401, 'Invalid email or password', 'text/plain; charset=utf-8')

    const error = await webSessionClient.signIn({ email: 'a@example.invalid', password: 'x' }).catch((failure) => failure)

    expect(error.response).toEqual({ status: 401, data: 'Invalid email or password' })
  })

  it('parses a JSON error body', async () => {
    stubFetch(401, JSON.stringify({ code: 'session_invalid' }))

    const error = await webSessionClient.refresh().catch((failure) => failure)

    expect(error.response).toEqual({ status: 401, data: { code: 'session_invalid' } })
  })

  describe('support reference (#340)', () => {
    beforeEach(() => clearRequestReference())

    it('keeps the request ID of a failed sign-in (header or body)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain', 'X-Request-Id': 'aaaaaaaa11111111' } })))
      await webSessionClient.signIn({ email: 'a@example.invalid', password: 'x' }).catch(() => {})
      expect(getRequestReference()).toBe('aaaaaaaa11111111')
      stubFetch(500, JSON.stringify({ code: 'internal_error', requestId: 'bbbbbbbb22222222' }))
      await webSessionClient.signIn({ email: 'a@example.invalid', password: 'x' }).catch(() => {})
      expect(getRequestReference()).toBe('bbbbbbbb22222222')
    })

    it('ignores sign-in 401 and never reports refresh or sign-out failures', async () => {
      stubFetch(401, JSON.stringify({ requestId: 'aaaaaaaa11111111' }))
      await webSessionClient.signIn({ email: 'a@example.invalid', password: 'x' }).catch(() => {})
      stubFetch(500, JSON.stringify({ requestId: 'aaaaaaaa11111111' }))
      await webSessionClient.refresh().catch(() => {})
      await webSessionClient.signOut().catch(() => {})
      expect(getRequestReference()).toBeNull()
    })
  })
})
