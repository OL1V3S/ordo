import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionsPage from './TransactionsPage'
import { useExpenses } from '../../expenses/hooks/useExpenses'
import { useImportPreview } from '../../importPreview/hooks/useImportPreview'

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

    await user.type(screen.getByPlaceholderText('Description'), '  Dinner With Friends  ')
    await user.type(screen.getByPlaceholderText('Amount'), '12.50')
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-08-14' } })
    const addEntry = screen.getByRole('heading', { name: 'Add Entry' }).closest('section')
    await user.selectOptions(within(addEntry).getByRole('combobox'), 'food')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(addExpense).toHaveBeenCalledWith({
      description: 'dinner with friends',
      amount: 12.5,
      date: '2026-08-14',
      category: 'food',
    })
  })

  it('uses the other sentinel to send a normalized custom category', async () => {
    const user = userEvent.setup()
    const addExpense = vi.fn().mockResolvedValue(undefined)
    useExpenses.mockReturnValue({ ...baseExpensesHook, addExpense })
    render(<TransactionsPage />)

    await user.type(screen.getByPlaceholderText('Description'), 'Prescription')
    await user.type(screen.getByPlaceholderText('Amount'), '8')
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-08-14' } })
    const addEntry = screen.getByRole('heading', { name: 'Add Entry' }).closest('section')
    await user.selectOptions(within(addEntry).getByRole('combobox'), 'other')
    await user.type(screen.getByPlaceholderText('Custom Category'), '  Medical Care  ')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(addExpense).toHaveBeenCalledWith(expect.objectContaining({
      category: 'medical care',
    }))
  })

  it('edits a custom-category expense with the URL id in the PUT body and rounds its amount', async () => {
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
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    expect(within(row).getByLabelText('Edit description')).toBeInTheDocument()
    expect(within(row).getByLabelText('Edit amount')).toBeInTheDocument()
    expect(within(row).getByLabelText('Edit date')).toBeInTheDocument()
    expect(within(row).getByLabelText('Edit category')).toBeInTheDocument()
    expect(within(row).getByRole('combobox')).toHaveValue('other')
    const textboxes = within(row).getAllByRole('textbox')
    await user.clear(textboxes[0])
    await user.type(textboxes[0], '  New Name  ')
    await user.clear(within(row).getByRole('spinbutton'))
    await user.type(within(row).getByRole('spinbutton'), '12.345')
    await user.clear(screen.getByPlaceholderText('Custom Category'))
    await user.type(screen.getByPlaceholderText('Custom Category'), '  Home Repair  ')
    expect(within(row).getByLabelText('Edit custom category')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    expect(updateExpense).toHaveBeenCalledWith(42, {
      id: 42,
      description: 'new name',
      amount: 12.35,
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

  it('keeps missing-field validation while using neutral copy', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)

    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(window.alert).toHaveBeenCalledWith('Complete all transaction fields.')
    expect(baseExpensesHook.addExpense).not.toHaveBeenCalled()
  })

  it('keeps the page transaction-focused without chart or budget-read controls', () => {
    render(<TransactionsPage />)

    expect(screen.getByRole('heading', { name: 'Transactions' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Description')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Spending vs Budget Limits' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Chart month')).not.toBeInTheDocument()
  })

  it('shows loading instead of a false empty state while expenses are pending', () => {
    useExpenses.mockReturnValue({ ...baseExpensesHook, loading: true })

    render(<TransactionsPage />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading expenses')
    expect(screen.queryByText('No expenses found.')).not.toBeInTheDocument()
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
    expect(screen.queryByText('No expenses found.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('shows the empty state only after a successful zero-row response', () => {
    render(<TransactionsPage />)

    expect(screen.getByText('No expenses found.')).toBeInTheDocument()
    expect(screen.queryByText('Loading expenses...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('uploads a PDF through the normal Transactions experience', async () => {
    const user = userEvent.setup()
    const upload = vi.fn().mockResolvedValue(null)
    useImportPreview.mockReturnValue({ ...baseImportHook, sourceType: 'sunflower_pdf', upload })
    render(<TransactionsPage />)
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

    await user.click(screen.getByRole('button', { name: 'Confirm 1 selected row' }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
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

    await user.click(screen.getByRole('button', { name: 'Confirm 1 selected row' }))

    expect(refresh).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The import succeeded, but Transactions could not be refreshed'
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
    await user.click(within(table).getByLabelText('Select for import'))
    expect(updateRow).toHaveBeenCalledWith('row-1', expect.objectContaining({ selectedForImport: true }))

    const description = within(table).getByLabelText('Expense description')
    await user.clear(description)
    await user.type(description, 'Morning coffee')
    await user.selectOptions(within(table).getByLabelText('Category'), 'food')
    await user.click(within(table).getByRole('button', { name: 'Save row' }))
    expect(updateRow).toHaveBeenLastCalledWith('row-1', {
      editableExpenseDescription: 'Morning coffee',
      category: 'food',
      selectedForImport: false,
      selectedForInflow: false,
    })
    expect(screen.getByRole('button', { name: 'Confirm selected rows' })).toBeDisabled()
  })
})
