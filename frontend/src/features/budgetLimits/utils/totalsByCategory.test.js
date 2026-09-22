import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeMonthlyTotalsByCategory } from './totalsByCategory'

describe('monthly spending totals used by budgets', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 14, 12, 0, 0))
  })

  afterEach(() => vi.useRealTimers())

  it('includes the current month through the end of today and excludes future days', () => {
    const result = computeMonthlyTotalsByCategory([
      { category: 'food', amount: 10.1, date: '2026-08-01' },
      { category: 'food', amount: 2.22, date: '2026-08-14' },
      { category: 'food', amount: 99, date: '2026-08-15' },
      { category: 'bills', amount: 50, date: '2026-07-31' },
    ], '2026-08')

    expect(result).toEqual({ food: '12.32' })
  })

  it('returns no spending for a future selected month', () => {
    expect(computeMonthlyTotalsByCategory([
      { category: 'food', amount: 10, date: '2026-09-01' },
    ], '2026-09')).toEqual({})
  })

  it('includes the full historical month and groups by exact category key', () => {
    const result = computeMonthlyTotalsByCategory([
      { category: 'food', amount: 1.115, date: '2026-07-01' },
      { category: 'food', amount: 2.225, date: '2026-07-31' },
      { category: 'Food', amount: 4, date: '2026-07-20' },
      { category: '', amount: 3, date: '2026-07-20' },
    ], '2026-07')

    expect(result).toEqual({ food: null, Food: '4.00', Uncategorized: '3.00' })
  })
})
