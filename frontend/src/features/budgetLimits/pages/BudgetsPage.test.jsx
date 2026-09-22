import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BudgetsPage from './BudgetsPage'
import { useExpenses } from '../../expenses/hooks/useExpenses'
import { useBudgetLimits } from '../hooks/useBudgetLimits'

vi.mock('../../expenses/hooks/useExpenses', () => ({ useExpenses: vi.fn() }))
vi.mock('../hooks/useBudgetLimits', () => ({ useBudgetLimits: vi.fn() }))
vi.mock('../components/BudgetLimitsPanel', () => ({
  default: ({ limitMonthYear, setLimitMonthYear, totalsByCategory, upsertLimit, deleteLimit, limitsLoading, limitsError, spendingLoading, spendingError, refreshLimits, refreshSpending }) => (
    <div data-testid="budget-panel">
      <span data-testid="limits-state">{limitsLoading ? 'loading' : limitsError ? 'error' : 'ready'}</span>
      <span data-testid="spending-state">{spendingLoading ? 'loading' : spendingError ? 'error' : 'ready'}</span>
      <button onClick={refreshLimits}>Refresh limits</button>
      <button onClick={refreshSpending}>Refresh spending</button>
      <span data-testid="budget-month">{limitMonthYear}</span>
      <span data-testid="budget-totals">{JSON.stringify(totalsByCategory)}</span>
      <button onClick={() => setLimitMonthYear('2026-07')}>Choose July</button>
      <button onClick={() => upsertLimit({ category: 'food' })}>Upsert</button>
      <button onClick={() => deleteLimit(7)}>Delete</button>
    </div>
  ),
}))

describe('Budgets page ownership', () => {
  const upsertLimit = vi.fn()
  const deleteLimit = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 14, 12, 0, 0))
    useExpenses.mockReturnValue({
      expenses: [
        { category: 'food', amount: 12.34, date: '2026-08-02' },
        { category: 'bills', amount: 50, date: '2026-07-02' },
      ],
    })
    useBudgetLimits.mockReturnValue({
      budgetLimits: [],
      loading: false,
      upsertLimit,
      deleteLimit,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('owns the current budget month, monthly totals, and budget mutations', () => {
    render(<BudgetsPage />)

    expect(screen.getByRole('heading', { name: 'Budgets' })).toBeInTheDocument()
    expect(screen.getByTestId('budget-month')).toHaveTextContent('2026-08')
    expect(screen.getByTestId('budget-totals')).toHaveTextContent('{"food":"12.34"}')
    expect(useBudgetLimits).toHaveBeenLastCalledWith('2026-08')

    fireEvent.click(screen.getByRole('button', { name: 'Upsert' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(upsertLimit).toHaveBeenCalledWith({ category: 'food' })
    expect(deleteLimit).toHaveBeenCalledWith(7)
  })

  it('updates budget-limit and spending dependencies when the owned month changes', () => {
    render(<BudgetsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose July' }))

    expect(screen.getByTestId('budget-month')).toHaveTextContent('2026-07')
    expect(screen.getByTestId('budget-totals')).toHaveTextContent('{"bills":"50.00"}')
    expect(useBudgetLimits).toHaveBeenLastCalledWith('2026-07')
  })
  it('forwards independent read states and retry functions to the budget presentation', () => {
    const refreshLimits = vi.fn()
    const refreshSpending = vi.fn()
    useBudgetLimits.mockReturnValue({ budgetLimits: [], loading: false, error: new Error('limits'), refresh: refreshLimits })
    useExpenses.mockReturnValue({ expenses: [], loading: true, error: null, refresh: refreshSpending })
    const { rerender } = render(<BudgetsPage />)
    expect(screen.getByTestId('limits-state')).toHaveTextContent('error')
    expect(screen.getByTestId('spending-state')).toHaveTextContent('loading')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh limits' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh spending' }))
    expect(refreshLimits).toHaveBeenCalledOnce()
    expect(refreshSpending).toHaveBeenCalledOnce()
    useExpenses.mockReturnValue({ expenses: [], loading: false, error: new Error('spending'), refresh: refreshSpending })
    rerender(<BudgetsPage />)
    expect(screen.getByTestId('spending-state')).toHaveTextContent('error')
  })

})
