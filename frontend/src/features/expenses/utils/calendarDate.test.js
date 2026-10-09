import { describe, expect, it } from 'vitest'
import { formatExpenseDate, formatLocalCalendarDate, localCalendarDateDaysAgo } from './calendarDate'

describe('expense calendar dates', () => {
  it('formats persisted dates without constructing a timezone-bearing instant', () => {
    expect(formatExpenseDate('2026-03-01')).toBe('03/01/2026')
  })

  it('formats local calendar components without UTC conversion', () => {
    expect(formatLocalCalendarDate(new Date(2026, 0, 1, 23, 30))).toBe('2026-01-01')
  })

  it('subtracts across month and year boundaries as calendar days', () => {
    expect(localCalendarDateDaysAgo(1, new Date(2026, 0, 1, 12))).toBe('2025-12-31')
    expect(localCalendarDateDaysAgo(1, new Date(2026, 2, 1, 12))).toBe('2026-02-28')
  })
  it('formats the numeric date in the requested language and keeps the fallback for malformed input', () => {
    expect(formatExpenseDate('2026-03-04', 'es')).toBe('04/03/2026')
    expect(formatExpenseDate('0001-01-01')).toBe('01/01/0001')
    expect(formatExpenseDate('2026-13-45')).toBe('13/45/2026')
    expect(formatExpenseDate('')).toBe('')
  })
})
