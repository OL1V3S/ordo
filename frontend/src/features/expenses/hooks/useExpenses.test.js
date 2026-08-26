import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expensesApi } from '../api/expensesApi'
import { useExpenses } from './useExpenses'

vi.mock('../api/expensesApi', () => ({
  expensesApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

describe('expense refresh behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    expensesApi.getAll.mockResolvedValue({ data: [] })
  })

  it('fetches expenses on initial mount', async () => {
    const { result } = renderHook(() => useExpenses())

    await waitFor(() => expect(expensesApi.getAll).toHaveBeenCalledOnce())
    expect(result.current.expenses).toEqual([])
  })

  it('exposes a safe refresh error and clears stale expenses', async () => {
    const requestError = new Error('unavailable')
    expensesApi.getAll.mockRejectedValue(requestError)
    const { result } = renderHook(() => useExpenses())

    await waitFor(() => expect(result.current.error).toBe(requestError))
    expect(result.current.expenses).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('creates through the existing API and refreshes expenses', async () => {
    const payload = { description: 'coffee', amount: 4, date: '2026-08-14', category: 'food' }
    expensesApi.getAll
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: 1, ...payload }] })
    const { result } = renderHook(() => useExpenses())
    await waitFor(() => expect(expensesApi.getAll).toHaveBeenCalledOnce())

    await act(() => result.current.addExpense(payload))

    expect(expensesApi.create).toHaveBeenCalledWith(payload)
    expect(expensesApi.getAll).toHaveBeenCalledTimes(2)
    expect(result.current.expenses).toEqual([{ id: 1, ...payload }])
  })

  it('updates through the existing API and refreshes expenses', async () => {
    const payload = { id: 7, description: 'lunch', amount: 12.35, date: '2026-08-14', category: 'food' }
    expensesApi.getAll.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [payload] })
    const { result } = renderHook(() => useExpenses())
    await waitFor(() => expect(expensesApi.getAll).toHaveBeenCalledOnce())

    await act(() => result.current.updateExpense(7, payload))

    expect(expensesApi.update).toHaveBeenCalledWith(7, payload)
    expect(expensesApi.getAll).toHaveBeenCalledTimes(2)
    expect(result.current.expenses).toEqual([payload])
  })

  it('deletes through the existing API and refreshes expenses', async () => {
    expensesApi.getAll.mockResolvedValue({ data: [] })
    const { result } = renderHook(() => useExpenses())
    await waitFor(() => expect(expensesApi.getAll).toHaveBeenCalledOnce())

    await act(() => result.current.deleteExpense(9))

    expect(expensesApi.remove).toHaveBeenCalledWith(9)
    expect(expensesApi.getAll).toHaveBeenCalledTimes(2)
  })
})
