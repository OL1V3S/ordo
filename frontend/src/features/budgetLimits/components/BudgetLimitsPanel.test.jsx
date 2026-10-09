import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BudgetLimitsPanel from './BudgetLimitsPanel'
import '../../../shared/localization/i18n'
import { chooseRowAction, openRowActions } from '../../../test/rowActions'

const baseProps = {
  limitMonthYear: '2026-08',
  setLimitMonthYear: vi.fn(),
  budgetLimits: [],
  limitsLoading: false,
  totalsByCategory: {},
  upsertLimit: vi.fn(),
  deleteLimit: vi.fn(),
}

describe('existing budget-limit workflows', () => {
  beforeEach(() => vi.spyOn(window, 'alert').mockImplementation(() => {}))

  it('creates a limit with normalized category, money, and selected month', async () => {
    const user = userEvent.setup()
    const upsertLimit = vi.fn().mockResolvedValue(undefined)
    render(<BudgetLimitsPanel {...baseProps} upsertLimit={upsertLimit} />)

    await user.click(screen.getByRole('button', { name: 'Add category budget' }))
    await user.selectOptions(screen.getByLabelText('Category'), 'food')
    await user.type(screen.getByPlaceholderText('Limit Amount'), '123.45')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))

    expect(upsertLimit).toHaveBeenCalledWith({
      category: 'food',
      limitAmount: 123.45,
      monthYear: new Date('2026-08-01T00:00:00').toISOString(),
    })
  })

  it('uses the other sentinel for a normalized custom budget category', async () => {
    const user = userEvent.setup()
    const upsertLimit = vi.fn().mockResolvedValue(undefined)
    render(<BudgetLimitsPanel {...baseProps} upsertLimit={upsertLimit} />)

    await user.click(screen.getByRole('button', { name: 'Add category budget' }))
    await user.selectOptions(screen.getByLabelText('Category'), 'other')
    await user.type(screen.getByPlaceholderText('Custom Category'), '  Home Repair  ')
    await user.type(screen.getByPlaceholderText('Limit Amount'), '80')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))

    expect(upsertLimit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'home repair',
      limitAmount: 80,
    }))
  })

  it('updates an existing exact category without changing its key', async () => {
    const user = userEvent.setup()
    const upsertLimit = vi.fn().mockResolvedValue(undefined)
    render(<BudgetLimitsPanel
      {...baseProps}
      upsertLimit={upsertLimit}
      budgetLimits={[{ id: 7, category: 'Home Repair', limitAmount: 50 }]}
      totalsByCategory={{ 'Home Repair': 10 }}
    />)

    const row = screen.getByRole('listitem', { name: 'Home Repair budget' })
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '$10.00 used of $50.00, 20%')
    await chooseRowAction(user, 'Edit Home Repair budget')
    expect(screen.getByLabelText('Limit amount for Home Repair')).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '75.25')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))

    expect(upsertLimit).toHaveBeenCalledWith({
      category: 'Home Repair',
      limitAmount: 75.25,
      monthYear: new Date('2026-08-01T00:00:00').toISOString(),
    })
  })
})

describe('budget hierarchy and truthful states', () => {
  it('explains incomplete add fields inline and focuses the first missing value without changing zero semantics', async () => {
    const user = userEvent.setup()
    const upsertLimit = vi.fn().mockResolvedValue({ refreshFailed: false })
    render(<BudgetLimitsPanel {...baseProps} upsertLimit={upsertLimit} />)
    await user.click(screen.getByRole('button', { name: 'Add category budget' }))
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a category and enter a limit amount.')
    expect(screen.getByLabelText('Category')).toHaveFocus()
    expect(screen.getByLabelText('Category')).toHaveAttribute('aria-invalid', 'true')
    await user.selectOptions(screen.getByLabelText('Category'), 'food')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(screen.getByLabelText('Limit amount')).toHaveFocus()
    expect(upsertLimit).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Limit amount'), '0{Enter}')
    expect(upsertLimit).toHaveBeenCalledWith(expect.objectContaining({ category: 'food', limitAmount: 0 }))
  })
  const limits = [
    { id: 1, category: 'food', limitAmount: 100 },
    { id: 2, category: 'bills', limitAmount: 100 },
    { id: 3, category: 'zero', limitAmount: 0 },
  ]
  it('leads with month and progress while keeping the add form and reset details closed', () => {
    render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} totalsByCategory={{ food: 95, bills: 125 }} />)
    expect(screen.getByLabelText('Budget month')).toHaveValue('2026-08')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    const food = screen.getByRole('listitem', { name: 'Food budget' })
    expect(within(food).getByText('Near limit')).toBeVisible()
    expect(within(food).getByRole('progressbar')).toHaveValue(95)
    const bills = screen.getByRole('listitem', { name: 'Bills budget' })
    expect(within(bills).getByText('Over limit')).toBeVisible()
    expect(within(bills).getByText('125% used')).toBeVisible()
    expect(within(bills).getByRole('progressbar')).toHaveValue(100)
    expect(within(bills).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '$125.00 used of $100.00, 125%')
    const zero = screen.getByRole('listitem', { name: 'Zero budget' })
    expect(within(zero).getByText('Zero limit')).toBeVisible()
    expect(within(zero).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(zero).toHaveClass('budget-row--warning')
    expect(screen.getByText('About monthly limits').closest('details')).not.toHaveAttribute('open')
  })
  it('fails closed for an unsafe limit and requires fresh input before repairing it', async () => {
    const user = userEvent.setup()
    render(<BudgetLimitsPanel {...baseProps}
      budgetLimits={[{ id: 7, category: 'food', limitAmount: Number('9999999999999999') }]}
      totalsByCategory={{ food: '9999999999999999.99' }} />)

    const food = screen.getByRole('listitem', { name: 'Food budget' })
    expect(within(food).getByText('Limit needs review')).toBeVisible()
    expect(within(food).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(food).not.toHaveClass('budget-row--warning')
    expect(food).not.toHaveTextContent(/Over limit|Limit reached|Near limit|Within limit/)
    expect(food).toHaveTextContent('Exact comparison is unavailable')

    await chooseRowAction(user, 'Edit Food budget')
    expect(screen.getByLabelText('Limit amount for Food')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save limit' })).toBeEnabled()
  })
  it.each([{ spendingLoading: true }, { spendingError: new Error('offline') }])('never renders zero spending or progress when the read is unavailable: %j', (state) => {
    render(<BudgetLimitsPanel {...baseProps} {...state} budgetLimits={limits} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    for (const card of within(screen.getByRole('list', { name: 'Category budgets' })).getAllByRole('listitem')) {
      expect(within(card).getByText('Unavailable')).toBeVisible()
      expect(within(card).getByText('Spending unavailable')).toBeVisible()
      expect(card).not.toHaveClass('budget-row--warning')
    }
    expect(screen.queryByText('Within limit')).not.toBeInTheDocument()
    expect(screen.queryByText('0% used')).not.toBeInTheDocument()
  })
  it('exposes separate limits and spending retries and never treats failures as empty budgets', async () => {
    const user = userEvent.setup()
    const refreshLimits = vi.fn().mockRejectedValue(new Error('offline'))
    const refreshSpending = vi.fn().mockRejectedValue(new Error('offline'))
    render(<BudgetLimitsPanel {...baseProps} limitsError={new Error('offline')} spendingError={new Error('offline')}
      refreshLimits={refreshLimits} refreshSpending={refreshSpending} />)
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.queryByText('No budget limits set for this month.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh limits' }))
    await user.click(screen.getByRole('button', { name: 'Retry spending' }))
    expect(refreshLimits).toHaveBeenCalledWith({ rethrow: true })
    expect(refreshSpending).toHaveBeenCalledOnce()
  })
  it('shows loading and missing-month prompts without false empty results', () => {
    const { rerender } = render(<BudgetLimitsPanel {...baseProps} limitsLoading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading budget limits')
    expect(screen.queryByText('No budget limits set for this month.')).not.toBeInTheDocument()
    rerender(<BudgetLimitsPanel {...baseProps} limitMonthYear="" />)
    expect(screen.getByRole('status')).toHaveTextContent('Choose a month')
    expect(screen.getByRole('button', { name: 'Add category budget' })).toBeDisabled()
  })
  it('keeps a draft visible through refresh failure, locks its month, and restores opener focus on cancel', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} />)
    await chooseRowAction(user, 'Edit Food budget')
    const input = screen.getByLabelText('Limit amount for Food')
    await user.clear(input)
    await user.type(input, '123.45')
    expect(screen.getByLabelText('Budget month')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add category budget' })).toBeDisabled()
    await user.click(screen.getByText('About monthly limits'))
    await user.click(screen.getByText('About monthly limits'))
    rerender(<BudgetLimitsPanel {...baseProps} limitsLoading />)
    expect(input).toHaveValue('123.45')
    expect(input).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save limit' })).toBeDisabled()
    rerender(<BudgetLimitsPanel {...baseProps} limitsError={new Error('offline')} />)
    expect(input).toHaveValue('123.45')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
    expect(screen.getByRole('heading', { name: 'Category budgets' })).toHaveFocus()
    expect(screen.getByLabelText('Budget month')).toBeEnabled()
  })
  it('keeps money-input behavior and permits an explicit zero limit', async () => {
    const user = userEvent.setup()
    const upsertLimit = vi.fn().mockResolvedValue(undefined)
    render(<BudgetLimitsPanel {...baseProps} upsertLimit={upsertLimit} />)
    await user.click(screen.getByRole('button', { name: 'Add category budget' }))
    await user.selectOptions(screen.getByLabelText('Category'), 'food')
    const amount = screen.getByLabelText('Limit amount')
    fireEvent.change(amount, { target: { value: '12.345' } })
    expect(amount).toHaveValue('')
    await user.type(amount, '0')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(upsertLimit).toHaveBeenCalledWith({ category: 'food', limitAmount: 0, monthYear: new Date('2026-08-01T00:00:00').toISOString() })
  })
  it('locks pending writes and retains an uncertain draft until a successful explicit refresh', async () => {
    const user = userEvent.setup()
    let rejectSave
    const upsertLimit = vi.fn(() => new Promise((resolve, reject) => { rejectSave = reject }))
    const refreshLimits = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} upsertLimit={upsertLimit} refreshLimits={refreshLimits} />)
    await chooseRowAction(user, 'Edit Food budget')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(screen.getByLabelText('Limit amount for Food')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Budget month')).toBeDisabled()
    await act(async () => rejectSave(new Error('uncertain')))
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t confirm the change')
    expect(screen.getByLabelText('Limit amount for Food')).toHaveValue('100.00')
    expect(screen.getByRole('button', { name: 'Save limit' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh limits' }))
    expect(screen.getByRole('button', { name: 'Save limit' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh limits' }))
    expect(screen.getByRole('button', { name: 'Save limit' })).toBeEnabled()
    expect(upsertLimit).toHaveBeenCalledOnce()
  })
  it('reports a known completed write separately from its failed refresh and clears that draft', async () => {
    const user = userEvent.setup()
    render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} upsertLimit={vi.fn().mockResolvedValue({ refreshFailed: true })} />)
    await chooseRowAction(user, 'Edit Food budget')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(screen.queryByLabelText('Limit amount for Food')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Budget limit saved. Budget limits could not be refreshed.')
    expect(screen.getByRole('button', { name: 'Actions for Food budget' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit Food budget', hidden: true })).toBeDisabled()
  })
  it('reports a completed delete with a failed refresh separately', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    const deleteLimit = vi.fn().mockResolvedValue({ refreshFailed: true })
    render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} deleteLimit={deleteLimit} />)
    await chooseRowAction(user, 'Delete Food budget')
    expect(deleteLimit).toHaveBeenCalledWith(1)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Budget limit deleted. Budget limits could not be refreshed. Refresh limits before making another change.')
  })
  it('retains explicit delete confirmation and the exact limit id', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const deleteLimit = vi.fn().mockResolvedValue(undefined)
    render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} deleteLimit={deleteLimit} />)
    await chooseRowAction(user, 'Delete Food budget')
    expect(deleteLimit).not.toHaveBeenCalled()
    await chooseRowAction(user, 'Delete Food budget')
    expect(confirm).toHaveBeenCalledWith('Delete budget limit for category "Food"?')
    expect(deleteLimit).toHaveBeenCalledWith(1)
  })
})

describe('budgets declutter (slice 7)', () => {
  const limits = [
    { id: 1, category: 'food', limitAmount: 100 },
    { id: 2, category: 'bills', limitAmount: 100 },
    { id: 3, category: 'zero', limitAmount: 0 },
  ]

  it('emits exact YYYY-MM values from the period picker', async () => {
    const user = userEvent.setup()
    const setLimitMonthYear = vi.fn()
    render(<BudgetLimitsPanel {...baseProps} setLimitMonthYear={setLimitMonthYear} />)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(setLimitMonthYear).toHaveBeenLastCalledWith('2026-07')
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(setLimitMonthYear).toHaveBeenLastCalledWith('2026-09')
    await user.selectOptions(screen.getByLabelText('Budget month'), '2025-12')
    expect(setLimitMonthYear).toHaveBeenLastCalledWith('2025-12')
    expect(screen.getByLabelText('Budget month')).toHaveDisplayValue('August 2026')
    expect(setLimitMonthYear).toHaveBeenCalledTimes(3)
  })

  it('offers This month, which emits the current month and is disabled when already current', async () => {
    const user = userEvent.setup()
    const current = new Date()
    const currentValue = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`
    const setLimitMonthYear = vi.fn()
    const { rerender } = render(<BudgetLimitsPanel {...baseProps} setLimitMonthYear={setLimitMonthYear} />)
    await user.click(screen.getByRole('button', { name: 'This month' }))
    expect(setLimitMonthYear).toHaveBeenCalledWith(currentValue)
    rerender(<BudgetLimitsPanel {...baseProps} limitMonthYear={currentValue} setLimitMonthYear={setLimitMonthYear} />)
    expect(screen.getByRole('button', { name: 'This month' })).toBeDisabled()
  })

  it('locks every period picker control while a task is open and unlocks it after cancel', async () => {
    const user = userEvent.setup()
    render(<BudgetLimitsPanel {...baseProps} />)
    await user.click(screen.getByRole('button', { name: 'Add category budget' }))
    for (const control of [screen.getByLabelText('Budget month'), screen.getByRole('button', { name: 'Previous month' }),
      screen.getByRole('button', { name: 'Next month' }), screen.getByRole('button', { name: 'This month' })]) {
      expect(control).toBeDisabled()
    }
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Budget month')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
  })

  it('keeps one status area with Refresh limits always mounted and Retry spending only on a spending error', () => {
    const { container, rerender } = render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} />)
    expect(container.querySelectorAll('.budget-status')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Refresh limits' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Retry spending' })).not.toBeInTheDocument()
    expect(container.querySelector('.budget-feedback')).toBeEmptyDOMElement()
    rerender(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} spendingError={new Error('offline')} />)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Retry spending' })).toBeEnabled()
  })

  it('opens the row menu, closes it with Escape back to the trigger, and leaves a cancelled delete untouched', async () => {
    const user = userEvent.setup()
    const deleteLimit = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    const { container } = render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} deleteLimit={deleteLimit} />)
    const panel = container.querySelector('.row-actions-menu__panel')
    expect(panel).not.toBeVisible()
    const trigger = await openRowActions(user, 'Food')
    expect(panel).toBeVisible()
    await user.keyboard('{Escape}')
    expect(panel).not.toBeVisible()
    expect(trigger).toHaveFocus()
    await chooseRowAction(user, 'Delete Food budget')
    expect(deleteLimit).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('returns focus to the row menu trigger after editing from the menu and cancelling', async () => {
    const user = userEvent.setup()
    render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} />)
    const trigger = await chooseRowAction(user, 'Edit Food budget')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
    expect(trigger).toHaveFocus()
  })

  it('renders rows in API order inside the labelled category budgets list', () => {
    render(<BudgetLimitsPanel {...baseProps} budgetLimits={limits} totalsByCategory={{ food: 95, bills: 125 }} />)
    const rows = within(screen.getByRole('list', { name: 'Category budgets' })).getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Food budget', 'Bills budget', 'Zero budget'])
  })
  it('shows the reset date in the short style and groups large percentages', () => {
    render(<BudgetLimitsPanel {...baseProps} budgetLimits={[{ id: 1, category: 'food', limitAmount: 100 }]} totalsByCategory={{ food: 1234 }} />)
    expect(screen.getByText('Next reset: Sep 1, 2026. Each limit applies to its selected calendar month.')).toBeInTheDocument()
    expect(screen.getByText('1,234% used')).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '$1,234.00 used of $100.00, 1,234%')
  })
})
