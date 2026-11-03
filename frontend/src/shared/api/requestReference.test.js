import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRequestReference, getRequestReference, parseRequestId, reportServerError, subscribeToRequestReference } from './requestReference'

describe('request reference', () => {
  beforeEach(() => clearRequestReference())

  it('accepts only plain 8 to 64 character tokens', () => {
    for (const ok of ['0123456789abcdef', 'ABCDEFGH', 'a1b2-c3d4-e5f6', 'a'.repeat(64)]) expect(parseRequestId(ok)).toBe(ok)
    for (const bad of ['short', 'a'.repeat(65), 'has space1234', 'abc\r\ndef12345', '<b>12345678', '', null, undefined, 12345678, {}]) expect(parseRequestId(bad)).toBeNull()
  })

  it('keeps the ID of a 5xx from the body field, else the header', () => {
    reportServerError({ status: 500, data: { requestId: 'aaaaaaaa11111111' }, headers: { 'x-request-id': 'bbbbbbbb22222222' } })
    expect(getRequestReference()).toBe('aaaaaaaa11111111')
    reportServerError({ status: 503, data: 'bad gateway', headers: { 'x-request-id': 'cccccccc33333333' } })
    expect(getRequestReference()).toBe('cccccccc33333333')
    reportServerError({ status: 500, data: '', headers: new Headers({ 'X-Request-Id': 'dddddddd44444444' }) })
    expect(getRequestReference()).toBe('dddddddd44444444')
  })

  it('ignores non-5xx statuses and invalid IDs', () => {
    for (const status of [200, 401, 404, 422, 429, 499]) reportServerError({ status, data: { requestId: 'aaaaaaaa11111111' } })
    reportServerError({ status: 500, data: { requestId: 'bad id!' }, headers: { 'x-request-id': 'x' } })
    reportServerError({ status: 500 })
    reportServerError()
    expect(getRequestReference()).toBeNull()
  })

  it('keeps only the newest ID, notifies on change and clears', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToRequestReference(listener)
    reportServerError({ status: 500, data: { requestId: 'aaaaaaaa11111111' } })
    reportServerError({ status: 500, data: { requestId: 'aaaaaaaa11111111' } })
    reportServerError({ status: 500, data: { requestId: 'bbbbbbbb22222222' } })
    expect(getRequestReference()).toBe('bbbbbbbb22222222')
    expect(listener).toHaveBeenCalledTimes(2)
    clearRequestReference()
    expect(getRequestReference()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    reportServerError({ status: 500, data: { requestId: 'cccccccc33333333' } })
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
