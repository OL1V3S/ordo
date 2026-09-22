import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionsPage from './TransactionsPage'
import { useInflows } from '../../inflows/hooks/useInflows'
import { useExpenses } from '../../expenses/hooks/useExpenses'
import { useImportPreview } from '../../importPreview/hooks/useImportPreview'

vi.mock('../../inflows/hooks/useInflows', () => ({ useInflows: vi.fn() }))
beforeEach(() => { useInflows.mockReturnValue({ inflows: [], loading: false, error: null, refresh: vi.fn().mockResolvedValue({ stale: false }), createInflow: vi.fn(), updateInflow: vi.fn(), deleteInflow: vi.fn() }) })

vi.mock('../../expenses/hooks/useExpenses', () => ({ useExpenses: vi.fn() }))
vi.mock('../../importPreview/hooks/useImportPreview', () => ({ useImportPreview: vi.fn() }))

const baseExpensesHook = {
  expenses: [],
  loading: false,
  error: null,
  refresh: vi.fn(),
  addExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
}

const baseImportHook = {
  preview: null,
  sourceType: '',
  loading: false,
  processing: false,
  error: '',
  confirming: false,
  confirmation: null,
  confirmationIssue: null,
  selectedCount: 0,
  selectSource: vi.fn(),
  upload: vi.fn(),
  cancel: vi.fn(),
  updateRow: vi.fn(),
  confirm: vi.fn(),
  clearForReupload: vi.fn(),
}

const selectedImportPreview = {
  batchId: '11111111-1111-1111-1111-111111111111',
  sourceType: 'sunflower_pdf',
  expiresAt: '2026-08-26T12:00:00Z',
  rows: [{
    rowId: 'row-1', sourceRowOrdinal: 1, postedDate: '2026-08-12', amount: 8.5,
    direction: 'debit', sourceDescription: 'SYNTHETIC CAFE', sourceSection: 'electronic_transactions',
    classification: 'expense_candidate', isEligible: true, errors: [], warnings: [],
    isPossibleDuplicate: false, editableExpenseDescription: 'Coffee', category: 'food',
    selectedForImport: true,
  }],
}

function creditImportRow() {
  return {
    ...selectedImportPreview.rows[0],
    rowId: 'row-credit',
    sourceRowOrdinal: 2,
    direction: 'credit',
    sourceDescription: 'SYNTHETIC DEPOSIT',
    classification: 'non_expense',
    isEligible: false,
    isInflowEligible: true,
    isPossibleInflowDuplicate: false,
    editableExpenseDescription: null,
    category: null,
    selectedForImport: false,
    selectedForInflow: true,
  }
}

function importResult(overrides = {}) {
  return {
    batchId: selectedImportPreview.batchId,
    status: 'confirmed',
    confirmedAt: '2026-08-25T21:00:00Z',
    importedExpenseCount: 0,
    importedInflowCount: 1,
    ...overrides,
  }
}

describe('existing expense workflows', () => {
  beforeEach(() => {
    useExpenses.mockReturnValue({ ...baseExpensesHook })
    useImportPreview.mockReturnValue({ ...baseImportHook })
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('normalizes a default category and description before adding an expense', async () => {
    const user = userEvent.setup()
    const addExpense = vi.fn().mockResolvedValue(undefined)
    useExpenses.mockReturnValue({ ...baseExpensesHook, addExpense })
    render(<TransactionsPage />)
    await user.click(screen.getByRole('button', { name: 'Add expense' }))

    await user.type(screen.getByPlaceholderText('Description'), '  Dinner With Friends  ')
    await user.type(screen.getByPlaceholderText('Amount'), '12.50')
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-08-14' } })
    const addEntry = screen.getByRole('heading', { name: 'Add expense' }).closest('section')
    await user.selectOptions(within(addEntry).getByRole('combobox'), 'food')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(addExpense).toHaveBeenCalledWith({
      description: 'dinner with friends',
      amount: '12.50',
      date: '2026-08-14',
      category: 'food',
    })
  })

  it.each(['-1', '1.234', '0', '1e2', '1,000'])('rejects unsupported exact amount input %s', async (amountInput) => {
    const user = userEvent.setup()
    const addExpense = vi.fn().mockResolvedValue(undefined)
    useExpenses.mockReturnValue({ ...baseExpensesHook, addExpense })
    render(<TransactionsPage />)
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    const addEntry = screen.getByRole('heading', { name: 'Add expense' }).closest('section')

    await user.type(within(addEntry).getByLabelText('Description'), 'Synthetic amount')
    fireEvent.change(within(addEntry).getByLabelText('Amount'), { target: { value: amountInput } })
    fireEvent.change(within(addEntry).getByLabelText('Date'), { target: { value: '2026-08-14' } })
    await user.selectOptions(within(addEntry).getByLabelText('Category'), 'food')
    await user.click(within(addEntry).getByRole('button', { name: 'Save expense' }))

    expect(addExpense).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('positive amount with at most two decimals')
  })

  it('uses the other sentinel to send a normalized custom category', async () => {
    const user = userEvent.setup()
    const addExpense = vi.fn().mockResolvedValue(undefined)
    useExpenses.mockReturnValue({ ...baseExpensesHook, addExpense })
    render(<TransactionsPage />)
    await user.click(screen.getByRole('button', { name: 'Add expense' }))

    await user.type(screen.getByPlaceholderText('Description'), 'Prescription')
    await user.type(screen.getByPlaceholderText('Amount'), '8')
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-08-14' } })
    const addEntry = screen.getByRole('heading', { name: 'Add expense' }).closest('section')
    await user.selectOptions(within(addEntry).getByRole('combobox'), 'other')
    await user.type(screen.getByPlaceholderText('Custom Category'), '  Medical Care  ')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(addExpense).toHaveBeenCalledWith(expect.objectContaining({
      category: 'medical care',
    }))
  })

  it('edits a custom-category expense with the URL id and an exact amount string', async () => {
    const user = userEvent.setup()
    const updateExpense = vi.fn().mockResolvedValue(undefined)
    useExpenses.mockReturnValue({
      ...baseExpensesHook,
      updateExpense,
      expenses: [{
        id: 42,
        description: 'old name',
        amount: 12,
        date: '2026-08-10',
        category: 'medical',
      }],
    })
    render(<TransactionsPage />)

    const row = screen.getByText('Medical').closest('tr')
    await user.click(within(row).getByRole('button', { name: /^Edit expense old name/i }))

    expect(within(row).getByLabelText('Edit description')).toBeInTheDocument()
    expect(within(row).getByLabelText('Edit amount')).toBeInTheDocument()
    expect(within(row).getByLabelText('Edit date')).toBeInTheDocument()
    expect(within(row).getByLabelText('Edit category')).toBeInTheDocument()
    expect(within(row).getByRole('combobox')).toHaveValue('other')
    const textboxes = within(row).getAllByRole('textbox')
    await user.clear(textboxes[0])
    await user.type(textboxes[0], '  New Name  ')
    await user.clear(within(row).getByLabelText('Edit amount'))
    await user.type(within(row).getByLabelText('Edit amount'), '12.34')
    await user.clear(screen.getByPlaceholderText('Custom Category'))
    await user.type(screen.getByPlaceholderText('Custom Category'), '  Home Repair  ')
    expect(within(row).getByLabelText('Edit custom category')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    expect(updateExpense).toHaveBeenCalledWith(42, {
      id: 42,
      description: 'new name',
      amount: '12.34',
      date: '2026-08-10',
      category: 'home repair',
    })
  })

  it('shows ten matches initially, expands, and resets when filters change', async () => {
    const user = userEvent.setup()
    useExpenses.mockReturnValue({
      ...baseExpensesHook,
      expenses: Array.from({ length: 12 }, (_, index) => ({
        id: index + 1,
        description: `expense ${index + 1}`,
        amount: index + 1,
        date: '2026-08-01',
        category: 'food',
      })),
    })
    render(<TransactionsPage />)

    expect(screen.getByRole('region', { name: 'Expenses table' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByText('Expenses', { selector: 'caption' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(11)
    await user.click(screen.getByRole('button', { name: 'Show More' }))
    expect(screen.getAllByRole('row')).toHaveLength(13)

    await user.type(screen.getByPlaceholderText('Search description or category...'), 'expense')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11))
    expect(screen.getByRole('button', { name: 'Show More' })).toBeInTheDocument()
  })

  it('shows inline missing-field validation and focuses the first invalid field', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Complete the required expense fields.')
    await waitFor(() => expect(screen.getByLabelText('Description')).toHaveFocus())
    expect(window.alert).not.toHaveBeenCalled()
    expect(baseExpensesHook.addExpense).not.toHaveBeenCalled()
  })

  it('keeps the page transaction-focused without chart or budget-read controls', () => {
    render(<TransactionsPage />)

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add expense' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('heading', { name: 'Spending vs Budget Limits' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Chart month')).not.toBeInTheDocument()
  })

  it('shows loading instead of a false empty state while expenses are pending', () => {
    useExpenses.mockReturnValue({ ...baseExpensesHook, loading: true })

    render(<TransactionsPage />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading expenses')
    expect(screen.queryByText('No expenses recorded yet.')).not.toBeInTheDocument()
  })

  it('shows a retryable error instead of an empty state when expense loading fails', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn().mockRejectedValue(new Error('offline'))
    useExpenses.mockReturnValue({
      ...baseExpensesHook,
      error: new Error('offline'),
      refresh,
    })

    render(<TransactionsPage />)

    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load your expenses')
    expect(screen.queryByText('No expenses recorded yet.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('shows the empty state only after a successful zero-row response', () => {
    render(<TransactionsPage />)

    expect(screen.getByText('No expenses recorded yet.')).toBeInTheDocument()
    expect(screen.queryByText('Loading expenses...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('uploads a PDF through the normal Transactions experience', async () => {
    const user = userEvent.setup()
    const upload = vi.fn().mockResolvedValue(null)
    useImportPreview.mockReturnValue({ ...baseImportHook, sourceType: 'sunflower_pdf', upload })
    render(<TransactionsPage />)
    await user.click(screen.getByRole('button', { name: 'Import statement' }))
    const file = new File(['synthetic'], 'statement.pdf', { type: 'application/pdf' })

    await user.upload(screen.getByLabelText('Sunflower statement PDF'), file)

    expect(upload).toHaveBeenCalledWith(file)
    expect(screen.getByText(/Expenses and explicitly selected incoming deposits are created only after confirmation/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm|import expenses/i })).not.toBeInTheDocument()
  })

  it('requires an explicit bank selection before enabling upload', async () => {
    const user = userEvent.setup()
    const selectSource = vi.fn()
    useImportPreview.mockReturnValue({ ...baseImportHook, selectSource })
    render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Import statement' }))
    expect(screen.getByRole('button', { name: 'Choose PDF' })).toBeDisabled()
    expect(screen.getByLabelText('Sunflower statement PDF')).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Bank'), 'sunflower_pdf')
    expect(selectSource).toHaveBeenCalledWith('sunflower_pdf')
  })

  it('shows processing and safe retry errors without statement details', async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    useImportPreview.mockReturnValue({
      ...baseImportHook,
      processing: true,
      error: 'Statement processing timed out. Try the upload again.',
      cancel,
    })
    render(<TransactionsPage />)

    expect(screen.getByRole('status')).toHaveTextContent('Processing the statement safely')
    expect(screen.getByRole('alert')).toHaveTextContent('Statement processing timed out')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalled()
  })

  it.each(['confirmed', 'already_confirmed'])('refreshes ordinary Expenses after %s import success', async (status) => {
    const user = userEvent.setup()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const result = {
      batchId: selectedImportPreview.batchId,
      status,
      confirmedAt: '2026-08-25T21:00:00Z',
      importedExpenseCount: 1,
      importedInflowCount: 0,
    }
    const confirm = vi.fn().mockResolvedValue(result)
    useExpenses.mockReturnValue({ ...baseExpensesHook, refresh })
    useImportPreview.mockReturnValue({
      ...baseImportHook,
      preview: selectedImportPreview,
      sourceType: 'sunflower_pdf',
      selectedCount: 1,
      confirm,
    })
    render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('refreshes only cash in after a credit-only import', async () => {
    const user = userEvent.setup()
    const refreshExpenses = vi.fn().mockResolvedValue(undefined)
    const refreshCash = vi.fn().mockResolvedValue({ stale: false })
    const result = importResult()
    useExpenses.mockReturnValue({ ...baseExpensesHook, refresh: refreshExpenses })
    useInflows.mockReturnValue({
      inflows: [], loading: false, error: null, refresh: refreshCash,
      createInflow: vi.fn(), updateInflow: vi.fn(), deleteInflow: vi.fn(),
    })
    useImportPreview.mockReturnValue({
      ...baseImportHook,
      preview: { ...selectedImportPreview, rows: [creditImportRow()] },
      sourceType: 'sunflower_pdf',
      selectedCount: 1,
      confirm: vi.fn().mockResolvedValue(result),
    })
    render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Save 0 expenses and 1 incoming deposit' }))

    expect(refreshCash).toHaveBeenCalledOnce()
    expect(refreshExpenses).not.toHaveBeenCalled()
  })

  it('refreshes both affected lists after a mixed import', async () => {
    const user = userEvent.setup()
    const refreshExpenses = vi.fn().mockResolvedValue(undefined)
    const refreshCash = vi.fn().mockResolvedValue({ stale: false })
    const result = importResult({ importedExpenseCount: 1 })
    useExpenses.mockReturnValue({ ...baseExpensesHook, refresh: refreshExpenses })
    useInflows.mockReturnValue({
      inflows: [], loading: false, error: null, refresh: refreshCash,
      createInflow: vi.fn(), updateInflow: vi.fn(), deleteInflow: vi.fn(),
    })
    useImportPreview.mockReturnValue({
      ...baseImportHook,
      preview: { ...selectedImportPreview, rows: [selectedImportPreview.rows[0], creditImportRow()] },
      sourceType: 'sunflower_pdf',
      selectedCount: 2,
      confirm: vi.fn().mockResolvedValue(result),
    })
    render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 1 incoming deposit' }))

    expect(refreshExpenses).toHaveBeenCalledOnce()
    expect(refreshCash).toHaveBeenCalledOnce()
  })

  it('uses the returned credit count for an already-confirmed import', async () => {
    const user = userEvent.setup()
    const refreshExpenses = vi.fn().mockResolvedValue(undefined)
    const refreshCash = vi.fn().mockResolvedValue({ stale: false })
    const result = importResult({ status: 'already_confirmed' })
    useExpenses.mockReturnValue({ ...baseExpensesHook, refresh: refreshExpenses })
    useInflows.mockReturnValue({
      inflows: [], loading: false, error: null, refresh: refreshCash,
      createInflow: vi.fn(), updateInflow: vi.fn(), deleteInflow: vi.fn(),
    })
    useImportPreview.mockReturnValue({
      ...baseImportHook,
      preview: { ...selectedImportPreview, rows: [creditImportRow()] },
      sourceType: 'sunflower_pdf',
      selectedCount: 1,
      confirm: vi.fn().mockResolvedValue(result),
    })
    render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Save 0 expenses and 1 incoming deposit' }))

    expect(refreshCash).toHaveBeenCalledOnce()
    expect(refreshExpenses).not.toHaveBeenCalled()
  })

  it.each([
    ['cash in', false, true],
    ['expenses', true, false],
  ])('preserves mixed import success when the %s refresh fails', async (failedList, expenseFails, cashFails) => {
    const user = userEvent.setup()
    const refreshExpenses = vi.fn()[expenseFails ? 'mockRejectedValue' : 'mockResolvedValue'](
      expenseFails ? new Error('expenses offline') : undefined,
    )
    const refreshCash = vi.fn()[cashFails ? 'mockRejectedValue' : 'mockResolvedValue'](
      cashFails ? new Error('cash in offline') : { stale: false },
    )
    const result = importResult({ importedExpenseCount: 1 })
    const confirm = vi.fn().mockResolvedValue(result)
    useExpenses.mockReturnValue({ ...baseExpensesHook, refresh: refreshExpenses })
    useInflows.mockReturnValue({
      inflows: [], loading: false, error: null, refresh: refreshCash,
      createInflow: vi.fn(), updateInflow: vi.fn(), deleteInflow: vi.fn(),
    })
    useImportPreview.mockReturnValue({
      ...baseImportHook,
      preview: { ...selectedImportPreview, rows: [selectedImportPreview.rows[0], creditImportRow()] },
      sourceType: 'sunflower_pdf',
      selectedCount: 2,
      confirm,
    })
    const { rerender } = render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 1 incoming deposit' }))

    expect(refreshExpenses).toHaveBeenCalledOnce()
    expect(refreshCash).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `The import succeeded, but Activity could not be refreshed for ${failedList}`,
    )

    useImportPreview.mockReturnValue({ ...baseImportHook, confirmation: result })
    rerender(<TransactionsPage />)
    expect(screen.getByRole('heading', { name: 'Import complete' })).toBeInTheDocument()
    expect(screen.getByText(/1 expense and 1 incoming deposit saved/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The import succeeded')
  })

  it('surfaces the established warning when post-confirmation Expense refresh fails', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn().mockRejectedValue(new Error('offline'))
    const confirm = vi.fn().mockResolvedValue({
      batchId: selectedImportPreview.batchId,
      status: 'confirmed',
      confirmedAt: '2026-08-25T21:00:00Z',
      importedExpenseCount: 1,
      importedInflowCount: 0,
    })
    useExpenses.mockReturnValue({ ...baseExpensesHook, refresh })
    useImportPreview.mockReturnValue({
      ...baseImportHook,
      preview: selectedImportPreview,
      sourceType: 'sunflower_pdf',
      selectedCount: 1,
      confirm,
    })
    render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' }))

    expect(refresh).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The import succeeded, but Activity could not be refreshed'
    )
  })

  it('renders resumed rows with duplicate and ineligible affordances and persists eligible edits', async () => {
    const user = userEvent.setup()
    const updateRow = vi.fn().mockResolvedValue(undefined)
    useImportPreview.mockReturnValue({
      ...baseImportHook,
      updateRow,
      preview: {
        batchId: '11111111-1111-1111-1111-111111111111',
        expiresAt: '2026-08-21T12:00:00Z',
        rows: [
          {
            rowId: 'row-1', sourceRowOrdinal: 1, postedDate: '2026-08-12', amount: 8.5,
            direction: 'debit', sourceDescription: 'REPEATED CAFE', sourceSection: 'electronic_transactions',
            classification: 'expense_candidate', isEligible: true, errors: [], warnings: ['possible_duplicate'],
            isPossibleDuplicate: true, editableExpenseDescription: 'REPEATED CAFE', category: 'uncategorized',
            selectedForImport: false,
          },
          {
            rowId: 'row-2', sourceRowOrdinal: 2, postedDate: '2026-08-13', amount: 12.34,
            direction: 'unresolved', sourceDescription: 'SOURCE DIRECTION UNKNOWN', sourceSection: 'electronic_transactions',
            classification: 'needs_review', isEligible: false, errors: [], warnings: [],
            isPossibleDuplicate: false, editableExpenseDescription: null, category: null,
            selectedForImport: false,
          },
        ],
      },
    })
    render(<TransactionsPage />)

    const table = screen.getByRole('region', { name: 'Statement import preview' })
    expect(within(table).getByText('Possible duplicate — review before selecting')).toBeInTheDocument()
    expect(within(table).getByText('Needs review')).toBeInTheDocument()
    expect(within(table).getByLabelText('Not selectable')).toBeDisabled()
    await user.click(within(table).getByLabelText(/^Select for import for /))
    expect(updateRow).toHaveBeenCalledWith('row-1', expect.objectContaining({ selectedForImport: true }))

    const description = within(table).getByLabelText(/^Expense description for /)
    await user.clear(description)
    await user.type(description, 'Morning coffee')
    await user.selectOptions(within(table).getByLabelText(/^Category for /), 'food')
    await user.click(within(table).getByRole('button', { name: /^Save row for / }))
    expect(updateRow).toHaveBeenLastCalledWith('row-1', {
      editableExpenseDescription: 'Morning coffee',
      category: 'food',
      selectedForImport: false,
      selectedForInflow: false,
    })
    expect(screen.getByRole('button', { name: 'Save 0 expenses and 0 incoming deposits' })).toBeDisabled()
  })
})

describe('Activity task hierarchy and safeguards', () => {
  const expense = { id: 42, description: 'Synthetic coffee', amount: 3.5, date: '2026-09-01', category: 'food' }
  beforeEach(() => {
    vi.clearAllMocks()
    useExpenses.mockReturnValue({ ...baseExpensesHook, expenses: [expense] })
    useImportPreview.mockReturnValue({ ...baseImportHook })
  })
  async function fillNewExpense(user) {
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    const task = document.getElementById('add-expense-task')
    await user.type(within(task).getByLabelText('Description'), 'Synthetic meal')
    await user.type(within(task).getByLabelText('Amount'), '12.50')
    fireEvent.change(within(task).getByLabelText('Date'), { target: { value: '2026-09-01' } })
    await user.selectOptions(within(task).getByLabelText('Category'), 'food')
    return task
  }
  it('starts with searchable spending and opens tasks with focus; a competing opener preserves the add draft', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)
    expect(screen.getByRole('heading', { name: 'Spending activity' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Choose PDF' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save expense' })).not.toBeInTheDocument()
    const task = await fillNewExpense(user)
    await user.click(screen.getByRole('button', { name: 'Import statement' }))
    expect(screen.getByRole('button', { name: 'Choose PDF' })).toBeVisible()
    expect(within(task).getByLabelText('Description')).toHaveValue('Synthetic meal')
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await waitFor(() => expect(within(task).getByLabelText('Description')).toHaveFocus())
    await user.click(within(task).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add expense' })).toHaveFocus())
    expect(task).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close import' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import statement' })).toHaveFocus())
  })
  it('keeps the idle import panel hidden during initial loading, while exposing resume loading', () => {
    useImportPreview.mockReturnValue({ ...baseImportHook, loading: true })
    const { rerender } = render(<TransactionsPage />)
    expect(document.getElementById('statement-import-task')).not.toBeVisible()
    window.history.replaceState({}, '', '/transactions?importBatch=synthetic')
    rerender(<TransactionsPage />)
    expect(document.getElementById('statement-import-task')).toBeVisible()
    window.history.replaceState({}, '', '/transactions')
  })
  it('distinguishes no matches and resets all filters with a visible clear action', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)
    await user.type(within(screen.getByRole('region', { name: 'Spending activity' })).getByRole('searchbox'), 'missing')
    expect(screen.getByText('No expenses match these filters.')).toBeVisible()
    expect(screen.queryByText('No expenses recorded yet.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Synthetic Coffee')).toBeVisible()
  })
  it('pins an active edit through filters and failed reads without replacing the draft', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TransactionsPage />)
    await user.click(screen.getByRole('button', { name: /^Edit expense/ }))
    await user.clear(screen.getByLabelText('Edit description'))
    await user.type(screen.getByLabelText('Edit description'), 'Unsaved description')
    await user.type(within(screen.getByRole('region', { name: 'Spending activity' })).getByRole('searchbox'), 'not a match')
    expect(screen.getByLabelText('Edit description')).toHaveValue('Unsaved description')
    useExpenses.mockReturnValue({ ...baseExpensesHook, expenses: [], error: new Error('offline') })
    rerender(<TransactionsPage />)
    expect(screen.getByLabelText('Edit description')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load your expenses')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Spending activity' })).toHaveFocus())
  })
  it('does not let a second edit replace a current draft', async () => {
    const user = userEvent.setup()
    useExpenses.mockReturnValue({ ...baseExpensesHook, expenses: [expense, { ...expense, id: 43, description: 'Other' }] })
    render(<TransactionsPage />)
    await user.click(screen.getAllByRole('button', { name: /^Edit expense/ })[0])
    await user.type(screen.getByLabelText('Edit description'), ' draft')
    expect(screen.getByRole('button', { name: /^Edit expense/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Delete expense/ })).toBeDisabled()
    expect(screen.getByLabelText('Edit description')).toHaveValue('Synthetic coffee draft')
  })
  it('gives repeated expense actions unique names while keeping their visible copy', () => {
    useExpenses.mockReturnValue({
      ...baseExpensesHook,
      expenses: [expense, { ...expense, id: 43 }],
    })
    render(<TransactionsPage />)

    expect(screen.getByRole('button', { name: 'Edit expense Synthetic Coffee from 09/01/2026, row 1' })).toHaveTextContent('Edit')
    expect(screen.getByRole('button', { name: 'Edit expense Synthetic Coffee from 09/01/2026, row 2' })).toHaveTextContent('Edit')
    expect(screen.getByRole('button', { name: 'Delete expense Synthetic Coffee from 09/01/2026, row 1' })).toHaveTextContent('Delete')
    expect(screen.getByRole('button', { name: 'Delete expense Synthetic Coffee from 09/01/2026, row 2' })).toHaveTextContent('Delete')
  })
  it('locks a pending save and keeps the task visible until the write completes', async () => {
    const user = userEvent.setup()
    let resolveSave
    const addExpense = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    useExpenses.mockReturnValue({ ...baseExpensesHook, expenses: [expense], addExpense })
    render(<TransactionsPage />)
    const task = await fillNewExpense(user)
    await user.click(within(task).getByRole('button', { name: 'Save expense' }))
    expect(within(task).getByLabelText('Description')).toBeDisabled()
    expect(within(task).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(within(task).getByRole('button', { name: 'Saving…' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(task).toBeVisible()
    expect(addExpense).toHaveBeenCalledOnce()
    await act(async () => { resolveSave({ refreshFailed: false }) })
    expect(task).not.toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Expense saved.')
  })
  it('keeps the draft and a visible warning after an uncertain write', async () => {
    const user = userEvent.setup()
    const addExpense = vi.fn().mockRejectedValue(new Error('offline'))
    const refresh = vi.fn().mockRejectedValueOnce(new Error('still offline')).mockResolvedValueOnce(undefined)
    useExpenses.mockReturnValue({ ...baseExpensesHook, addExpense, refresh })
    render(<TransactionsPage />)
    const task = await fillNewExpense(user)
    await user.click(within(task).getByRole('button', { name: 'Save expense' }))
    expect(within(task).getByLabelText('Description')).toHaveValue('Synthetic meal')
    expect(task).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh activity and check the records before trying again')
    const save = within(task).getByRole('button', { name: 'Save expense' })
    expect(save).toBeDisabled()
    await user.click(save)
    expect(addExpense).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Refresh activity' }))
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh activity' }))
    expect(save).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Activity refreshed. Check the records')
  })
  it('reports a successful save separately from a failed read and clears the completed draft', async () => {
    const user = userEvent.setup()
    const addExpense = vi.fn().mockResolvedValue({ refreshFailed: true })
    useExpenses.mockReturnValue({ ...baseExpensesHook, addExpense })
    render(<TransactionsPage />)
    const task = await fillNewExpense(user)
    await user.click(within(task).getByRole('button', { name: 'Save expense' }))
    expect(task).not.toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Expense saved. Activity could not be refreshed.')
    expect(addExpense).toHaveBeenCalledOnce()
  })
  it('requires an explicit confirmation before deleting an expense', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const deleteExpense = vi.fn().mockResolvedValue({ refreshFailed: false })
    useExpenses.mockReturnValue({ ...baseExpensesHook, expenses: [expense], deleteExpense })
    render(<TransactionsPage />)
    await user.click(screen.getByRole('button', { name: /^Delete expense/ }))
    expect(deleteExpense).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /^Delete expense/ }))
    expect(confirm).toHaveBeenCalledWith('Delete this expense?')
    expect(deleteExpense).toHaveBeenCalledExactlyOnceWith(42)
    expect(screen.getByRole('status')).toHaveTextContent('Expense deleted.')
  })
  it.each([
    { preview: selectedImportPreview }, { processing: true }, { loading: true, sourceType: 'sunflower_pdf' },
    { error: 'Safe import failure' }, { confirming: true },
    { confirmationIssue: { code: 'preview_expired', message: 'Preview expired', rows: [] } },
    { confirmation: { status: 'confirmed', confirmedAt: '2026-09-01T00:00:00Z', importedExpenseCount: 1, importedInflowCount: 0 } },
  ])('automatically exposes important import state and offers no close control: %j', (state) => {
    useImportPreview.mockReturnValue({ ...baseImportHook, ...state })
    render(<TransactionsPage />)
    expect(document.getElementById('statement-import-task')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import statement' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: 'Close import' })).not.toBeInTheDocument()
  })
})
