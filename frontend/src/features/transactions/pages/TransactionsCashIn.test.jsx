import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionsPage from './TransactionsPage'
import '../../../shared/localization/i18n'
import { useInflows } from '../../inflows/hooks/useInflows'
import { useExpenses } from '../../expenses/hooks/useExpenses'
import { useImportPreview } from '../../importPreview/hooks/useImportPreview'
import { useActivityTimeline } from '../../activity/hooks/useActivityTimeline'
import { chooseRowAction, timelineFrom } from '../../../test/rowActions'
vi.mock('../../inflows/hooks/useInflows', () => ({ useInflows: vi.fn() }))
vi.mock('../../expenses/hooks/useExpenses', () => ({ useExpenses: vi.fn() }))
vi.mock('../../importPreview/hooks/useImportPreview', () => ({ useImportPreview: vi.fn() }))
vi.mock('../../activity/hooks/useActivityTimeline', () => ({ useActivityTimeline: vi.fn() }))
const idleTimeline = { items: [], hasMore: false, loading: false, error: false, refreshFailed: false, malformed: false, loadingMore: false, loadMoreFailed: false, loadMore: vi.fn(), refresh: vi.fn().mockResolvedValue({ stale: false }) }
const record = { id: 1, description: 'Transfer from Savings', amount: 24.15, date: '2026-09-01' }
let cash, expenses, importing
beforeEach(() => {
  cash = { inflows: [record], loading: false, error: null, refresh: vi.fn().mockResolvedValue({ stale: false }), createInflow: vi.fn().mockResolvedValue({ refreshFailed: false }), updateInflow: vi.fn().mockResolvedValue({ refreshFailed: false }), deleteInflow: vi.fn().mockResolvedValue({ refreshFailed: false }) }
  expenses = { expenses: [], loading: false, error: null, refresh: vi.fn().mockResolvedValue({}), addExpense: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn() }
  importing = { preview: null, sourceType: '', loading: false, processing: false, error: '', confirming: false, confirmation: null, confirmationIssue: null, selectedCount: 0, selectSource: vi.fn(), upload: vi.fn(), cancel: vi.fn(), updateRow: vi.fn(), confirm: vi.fn(), clearForReupload: vi.fn() }
  useActivityTimeline.mockImplementation(() => ({ ...idleTimeline, items: timelineFrom(expenses.expenses, cash.inflows) }))
  useInflows.mockImplementation(() => cash)
  useExpenses.mockImplementation(() => expenses)
  useImportPreview.mockImplementation(() => importing)
})
async function draft(user) {
  await user.click(screen.getByRole('button', { name: 'Add cash in', exact: true }))
  const form = screen.getByRole('form', { name: 'Add cash in' })
  await user.type(within(form).getByLabelText('Description'), '  Refund  From Store  ')
  await user.type(within(form).getByLabelText('Amount'), '9999999999999999.99')
  fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-09-02' } })
  return form
}
const submit = (form) => fireEvent.submit(form)

describe('Activity cash-in tasks', () => {
  it('submits exact values once while pending and clears the completed draft', async () => {
    let complete
    cash.createInflow.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const user = userEvent.setup()
    render(<TransactionsPage />)
    const form = await draft(user)
    submit(form); submit(form)
    expect(cash.createInflow).toHaveBeenCalledTimes(1)
    expect(cash.createInflow).toHaveBeenCalledWith({ description: 'Refund  From Store', amount: '9999999999999999.99', date: '2026-09-02' })
    expect(within(form).getByLabelText('Amount')).toBeDisabled()
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await act(async () => complete({ refreshFailed: false }))
    expect(screen.queryByRole('form', { name: 'Add cash in' })).not.toBeInTheDocument()
    expect(screen.getByText('Cash in saved. Reports use this entry’s posted date.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Insights' })).toHaveAttribute('href', '/analytics')
  })
  it('gates an unknown draft until a successful explicit read and acknowledgement', async () => {
    cash.createInflow.mockRejectedValue(new Error('private payload'))
    const user = userEvent.setup()
    render(<TransactionsPage />)
    const form = await draft(user)
    submit(form)
    const ack = await screen.findByRole('button', { name: 'I checked cash in' })
    expect(ack).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Check your records' })).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Cash in table' })).queryAllByRole('button')).toHaveLength(0)
    expect(document.getElementById('cash-in-task')).toBeVisible()
    expect(within(form).getByLabelText('Description')).toHaveValue('  Refund  From Store  ')
    expect(within(form).getByRole('button', { name: 'Add cash in' })).toBeDisabled()
    cash.refresh.mockRejectedValueOnce(new Error('read failed'))
    await user.click(screen.getByRole('button', { name: 'Refresh cash in' }))
    expect(ack).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh cash in' }))
    expect(ack).toBeEnabled()
    await user.click(ack)
    expect(within(form).getByRole('button', { name: 'Add cash in' })).toBeEnabled()
    expect(cash.createInflow).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/private payload/)).not.toBeInTheDocument()
  })
  it('retains known write success after failed refresh without offering the completed create', async () => {
    cash.createInflow.mockResolvedValue({ refreshFailed: true })
    const user = userEvent.setup()
    render(<TransactionsPage />)
    submit(await draft(user))
    await screen.findByText(/Cash in saved.*could not be refreshed/)
    expect(screen.queryByRole('form', { name: 'Add cash in' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add cash in' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'I checked cash in' })).not.toBeInTheDocument()
    cash.refresh.mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('button', { name: 'Refresh cash in' }))
    expect(screen.getByRole('button', { name: 'Add cash in' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh cash in' }))
    expect(screen.getByRole('button', { name: 'Add cash in' })).toBeEnabled()
    expect(cash.createInflow).toHaveBeenCalledTimes(1)
  })
  it('maps validation keys safely, preserves the draft and focuses the invalid field', async () => {
    cash.createInflow.mockRejectedValue({ response: { status: 400, data: { errors: { Amount: ['private server value'] } } } })
    const user = userEvent.setup()
    render(<TransactionsPage />)
    const form = await draft(user)
    submit(form)
    await waitFor(() => expect(within(form).getByLabelText('Amount')).toHaveFocus())
    expect(within(form).getByLabelText('Amount')).toHaveValue('9999999999999999.99')
    expect(screen.queryByText('private server value')).not.toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Add cash in' })).toBeEnabled()
  })
  it('keeps an open cash edit through a failed read and returns Cancel focus', async () => {
    const user = userEvent.setup()
    const view = render(<TransactionsPage />)
    const trigger = await chooseRowAction(user, /^Edit cash in Transfer/)
    const form = screen.getByRole('form', { name: 'Edit cash in' })
    await user.type(within(form).getByLabelText('Description'), ' revised')
    cash = { ...cash, error: new Error('offline'), inflows: [] }
    view.rerender(<TransactionsPage />)
    expect(within(form).getByLabelText('Description')).toHaveValue('Transfer from Savings revised')
    expect(form).toBeVisible()
    expect(within(form).getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toHaveFocus())
    expect(trigger).not.toBeInTheDocument()
  })
  it('requires refresh after 404 and prevents resubmitting an unavailable target', async () => {
    cash.updateInflow.mockRejectedValue({ response: { status: 404 } })
    const user = userEvent.setup()
    const view = render(<TransactionsPage />)
    await chooseRowAction(user, /^Edit cash in Transfer/)
    const form = screen.getByRole('form', { name: 'Edit cash in' })
    submit(form)
    await screen.findByText(/This cash-in record is unavailable/)
    expect(cash.updateInflow).toHaveBeenCalledWith(1, { id: 1, description: record.description, amount: '24.15', date: record.date })
    cash = { ...cash, inflows: [] }
    await user.click(screen.getByRole('button', { name: 'Refresh cash in' }))
    view.rerender(<TransactionsPage />)
    expect(within(form).getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByText(/Cancel this task to choose another record/)).toBeInTheDocument()
  })
  it('requires record-specific delete confirmation with link and import consequences', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)
    await chooseRowAction(user, /^Delete cash in Transfer/)
    expect(screen.getByRole('heading', { name: /Delete cash in: Transfer from Savings/ })).toBeInTheDocument()
    expect(screen.getByText(/supporting paycheck link is removed/)).toBeInTheDocument()
    expect(screen.getByText(/same confirmed statement again will not restore/)).toBeInTheDocument()
    expect(cash.deleteInflow).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm delete cash in' }))
    expect(cash.deleteInflow).toHaveBeenCalledWith(1)
    await screen.findByText(/Cash in deleted/)
  })
  it('preserves an expense draft when cash in is requested', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    const field = screen.getByPlaceholderText('Description')
    await user.type(field, 'Expense draft')
    await user.click(screen.getByRole('button', { name: 'Add cash in' }))
    expect(screen.queryByRole('form', { name: 'Add cash in' })).not.toBeInTheDocument()
    expect(field).toHaveValue('Expense draft')
    await waitFor(() => expect(field).toHaveFocus())
    expect(screen.getByText(/Finish or close the open expense or import task/)).toBeInTheDocument()
  })
  it('preserves cash in against expense/import openers and a resumed import', async () => {
    const user = userEvent.setup()
    const view = render(<TransactionsPage />)
    const form = await draft(user)
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('button', { name: 'Import statement' }))
    expect(screen.queryByRole('heading', { name: 'Add expense' })).not.toBeInTheDocument()
    expect(within(form).getByLabelText('Amount')).toHaveValue('9999999999999999.99')
    importing = { ...importing, processing: true }
    view.rerender(<TransactionsPage />)
    expect(within(form).getByRole('button', { name: 'Add cash in' })).toBeDisabled()
    expect(within(form).getByLabelText('Description')).toHaveValue('  Refund  From Store  ')
    expect(importing.upload).not.toHaveBeenCalled()
  })
  it('disables cash row triggers while the cash read is failed', async () => {
    cash = { ...cash, error: new Error('offline') }
    render(<TransactionsPage />)
    expect(screen.getByRole('button', { name: /^Actions for cash in Transfer/ })).toBeDisabled()
  })
  it('leaves expenses available on a cash-in read failure without showing a false empty ledger', async () => {
    cash = { ...cash, inflows: [], error: new Error('offline') }
    const user = userEvent.setup()
    render(<TransactionsPage />)
    expect(screen.getByText(/We couldn’t load cash in/)).toBeInTheDocument()
    expect(screen.queryByText(/No cash in recorded yet/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(screen.getByRole('heading', { name: 'Add expense' })).toBeInTheDocument()
  })
  it('allows cash in after a known completed import', async () => {
    importing = { ...importing, confirmation: { importedExpenseCount: 0, importedInflowCount: 1, alreadyConfirmed: false } }
    const user = userEvent.setup()
    render(<TransactionsPage />)
    await user.click(screen.getByRole('button', { name: 'Add cash in' }))
    expect(screen.getByRole('form', { name: 'Add cash in' })).toBeInTheDocument()
  })
})
