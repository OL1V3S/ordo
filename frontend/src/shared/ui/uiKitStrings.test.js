import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('./*.jsx', { query: '?raw', import: 'default', eager: true })

describe('shared UI kit sources', () => {
  const kit = Object.entries(sources).filter(([path]) => !path.endsWith('.test.jsx'))

  it('finds the kit components', () => {
    expect(kit.length).toBeGreaterThanOrEqual(8)
  })

  it.each(kit)('%s has no hard-coded English or literal accessible text', (path, source) => {
    expect(source).not.toMatch(/\b(aria-label|title|placeholder|alt)="[^"]+"/)
    expect(source).not.toMatch(/>\s*[A-Za-z][^<>{}]*\s*</)
  })
})
