// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Guards the production security headers in vercel.json (#307).
const frontendDir = new URL('../../', import.meta.url)
const vercel = JSON.parse(readFileSync(new URL('vercel.json', frontendDir), 'utf8'))
const indexHtml = readFileSync(new URL('index.html', frontendDir), 'utf8')

const headerRule = vercel.headers?.find((rule) => rule.source === '/(.*)')
const header = (key) => headerRule?.headers.find((h) => h.key === key)?.value
const csp = header('Content-Security-Policy') ?? ''
const directive = (name) =>
  csp.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) ?? []

const webSessionRewriteIndex = vercel.rewrites.findIndex((r) => r.source.startsWith('/api/auth/web-session/'))
const catchAllIndex = vercel.rewrites.findIndex((r) => r.source === '/(.*)')

const inlineScriptPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g

describe('vercel.json security headers', () => {
  it('applies one header rule to every path', () => {
    expect(vercel.headers).toHaveLength(1)
    expect(headerRule).toBeDefined()
  })

  it('sends all five security headers', () => {
    expect(csp).not.toBe('')
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('X-Frame-Options')).toBe('DENY')
    // Not no-referrer: same-origin POSTs would send Origin: null and the
    // web-session guard would reject them.
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header('Permissions-Policy')).toContain('camera=()')
    // Vercel already sends a stronger HSTS header.
    expect(header('Strict-Transport-Security')).toBeUndefined()
  })

  it('never allows inline or eval script/style', () => {
    expect(csp).not.toContain("'unsafe-inline'")
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('detects inline scripts that carry attributes but not external ones', () => {
    const html = '<script type="module">a()</script><script src="/x.js"></script><script>b()</script>'
    expect([...html.matchAll(inlineScriptPattern)].map((m) => m[1])).toEqual(['a()', 'b()'])
  })

  it('allows the inline theme script by the hash of its exact bytes', () => {
    const scripts = [...indexHtml.matchAll(inlineScriptPattern)]
    expect(scripts).toHaveLength(1)
    const hash = createHash('sha256').update(scripts[0][1], 'utf8').digest('base64')
    expect(directive('script-src')).toContain(`'sha256-${hash}'`)
  })

  it('allows the API origin in connect-src', () => {
    // The axios target comes from VITE_API_BASE_URL (a Vercel env var, not in
    // the repo). The web-session rewrite destination stands in for it; this is
    // only valid while both point at the same Render host.
    const origin = new URL(vercel.rewrites[webSessionRewriteIndex].destination.replace(':path*', '')).origin
    expect(directive('connect-src')).toContain(origin)
  })

  it('keeps the web-session rewrite before the SPA catch-all', () => {
    expect(webSessionRewriteIndex).toBeGreaterThanOrEqual(0)
    expect(catchAllIndex).toBeGreaterThan(webSessionRewriteIndex)
  })
})
