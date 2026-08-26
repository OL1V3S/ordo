import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { budgetLimitsApi } from '../api/budgetLimitsApi'
import { useBudgetLimits } from './useBudgetLimits'

vi.mock('../api/budgetLimitsApi', () => ({
  budgetLimitsApi: {
    getByMonth: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
  },
}))

describe('budget-limit refresh behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    budgetLimitsApi.getByMonth.mockResolvedValue({ data: [] })
  })

  it('exposes a selected-month fetch error without stale limits', async () => {
    const requestError = new Error('unavailable')
    budgetLimitsApi.getByMonth.mockRejectedValue(requestError)
    const { result } = renderHook(() => useBudgetLimits('2026-08'))

    await waitFor(() => expect(result.current.error).toBe(requestError))
    expect(result.current.budgetLimits).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('ignores an older month response after the selection changes', async () => {
    let resolveJuly
    let resolveAugust
    budgetLimitsApi.getByMonth.mockImplementation((month) => new Promise((resolve) => {
      if (month === '2026-07') resolveJuly = resolve
      if (month === '2026-08') resolveAugust = resolve
    }))
    const { result, rerender } = renderHook(
      ({ month }) => useBudgetLimits(month),
      { initialProps: { month: '2026-07' } }
    )
    await waitFor(() => expect(resolveJuly).toBeTypeOf('function'))

    rerender({ month: '2026-08' })
    await waitFor(() => expect(resolveAugust).toBeTypeOf('function'))
    await act(() => resolveJuly({ data: [{ id: 7, category: 'old' }] }))
    expect(result.current.budgetLimits).toEqual([])

    await act(() => resolveAugust({ data: [{ id: 8, category: 'current' }] }))
    expect(result.current.budgetLimits).toEqual([{ id: 8, category: 'current' }])
  })

  it('upserts and refreshes the currently selected month', async () => {
    const payload = { category: 'food', limitAmount: 100, monthYear: '2026-08-01T05:00:00.000Z' }
    const { result } = renderHook(() => useBudgetLimits('2026-08'))
    await waitFor(() => expect(budgetLimitsApi.getByMonth).toHaveBeenCalledWith('2026-08'))

    await act(() => result.current.upsertLimit(payload))

    expect(budgetLimitsApi.upsert).toHaveBeenCalledWith(payload)
    expect(budgetLimitsApi.getByMonth).toHaveBeenCalledTimes(2)
    expect(budgetLimitsApi.getByMonth).toHaveBeenLastCalledWith('2026-08')
  })

  it('deletes and refreshes the currently selected month', async () => {
    const { result } = renderHook(() => useBudgetLimits('2026-08'))
    await waitFor(() => expect(budgetLimitsApi.getByMonth).toHaveBeenCalledWith('2026-08'))

    await act(() => result.current.deleteLimit(12))

    expect(budgetLimitsApi.remove).toHaveBeenCalledWith(12)
    expect(budgetLimitsApi.getByMonth).toHaveBeenCalledTimes(2)
    expect(budgetLimitsApi.getByMonth).toHaveBeenLastCalledWith('2026-08')
  })
})
