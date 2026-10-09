import { describe, expect, it } from 'vitest'
import { neighbourMonths } from './periodNeighbours'

describe('neighbourMonths', () => {
  const months = ['2026-08', '2026-07', '2026-02']

  it('finds the nearest listed months on both sides, skipping gaps, from unsorted input', () => {
    expect(neighbourMonths(months, '2026-07')).toEqual({ earlier: '2026-02', later: '2026-08' })
    expect(neighbourMonths(months, '2026-05')).toEqual({ earlier: '2026-02', later: '2026-07' })
  })

  it('has no later month at the newest and no earlier month at the oldest', () => {
    expect(neighbourMonths(months, '2026-08')).toEqual({ earlier: '2026-07', later: undefined })
    expect(neighbourMonths(months, '2026-02')).toEqual({ earlier: undefined, later: '2026-07' })
  })

  it('ignores duplicates and the value itself', () => {
    expect(neighbourMonths(['2026-03', '2026-03', '2026-01', '2026-05', '2026-05'], '2026-03'))
      .toEqual({ earlier: '2026-01', later: '2026-05' })
  })

  it('returns no neighbours for an empty value or empty list', () => {
    expect(neighbourMonths(months, '')).toEqual({ earlier: undefined, later: undefined })
    expect(neighbourMonths([], '2026-07')).toEqual({ earlier: undefined, later: undefined })
  })
})
