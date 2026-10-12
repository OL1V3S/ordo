import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportPreviewPanel from './ImportPreviewPanel'
import i18n from '../../../shared/localization/i18n'

const base = {
  rowId: 'e1',
  sourceRowOrdinal: 1,
  postedDate: '2026-08-12',
  amount: '8.50',
  direction: 'debit',
  sourceDescription: 'CAFE ONE',
  sourceSection: 'electronic_transactions',
  classification: 'expense_candidate',
  isEligible: true,
  isInflowEligible: false,
  errors: [],
  warnings: [],
  isPossibleDuplicate: false,
  isPossibleInflowDuplicate: false,
  duplicateExpenseIds: [],
  editableExpenseDescription: 'Coffee',
  category: 'food',
  selectedForImport: false,
  selectedForInflow: false,
}
const e1 = base
const e2 = { ...base, rowId: 'e2', sourceRowOrdinal: 2, sourceDescription: 'CAFE TWO', amount: '0.20' }
const dup = { ...base, rowId: 'dup', sourceRowOrdinal: 3, sourceDescription: 'CAFE DUP', isPossibleDuplicate: true, warnings: ['possible_duplicate'] }
const dep = {
  ...base,
  rowId: 'dep',
  sourceRowOrdinal: 4,
  sourceDescription: 'PAY DEPOSIT',
  amount: '100.00',
  direction: 'credit',
  classification: 'non_expense',
  isEligible: false,
  isInflowEligible: true,
  editableExpenseDescription: null,
  category: null,
}
const review = { ...base, rowId: 'nr', sourceRowOrdinal: 5, sourceDescription: 'ODD ROW', classification: 'needs_review', isEligible: false, errors: ['invalid_transaction_amount'] }

const BATCH = '11111111-1111-1111-1111-111111111111'
const previewWith = (rows, batchId = BATCH) => ({ batchId, sourceType: 'sunflower_pdf', expiresAt: '2026-08-26T12:00:00Z', rows })

function importState(overrides = {}) {
  const preview = overrides.preview === undefined ? previewWith([e1, e2, dup, dep, review]) : overrides.preview
  return {
    preview,
    sourceType: 'sunflower_pdf',
    loading: false,
    processing: false,
    error: '',
    confirming: false,
    confirmation: null,
    confirmedRows: null,
    confirmationIssue: null,
    selectedCount: preview?.rows.filter((row) => (row.isEligible && row.selectedForImport) || (row.isInflowEligible && row.selectedForInflow)).length ?? 0,
    selectSource: vi.fn(),
    upload: vi.fn(),
    cancel: vi.fn(),
    updateRow: vi.fn(async (rowId, payload) => ({ ...[e1, e2, dup, dep, review].find((row) => row.rowId === rowId), ...payload })),
    confirm: vi.fn(),
    clearForReupload: vi.fn(),
    dismissConfirmation: vi.fn(),
    ...overrides,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const tableRegion = () => screen.getByRole('region', { name: 'Statement preview' })
const selectAll = () => screen.getByRole('button', { name: /^Select all eligible expenses/ })
const clearSelection = () => screen.getByRole('button', { name: 'Clear selection' })

describe('import review summary, filters and bar', () => {
  it('summarizes the whole statement and offers radio filters with counts', () => {
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([{ ...e1, selectedForImport: true }, e2, dup, dep, review]) })} />)
    const summary = screen.getByRole('region', { name: 'Statement summary' })
    const value = (label) => within(summary).getByText(label, { selector: 'dt' }).nextSibling
    expect(value('Expenses selected')).toHaveTextContent('1')
    expect(value('Deposits selected')).toHaveTextContent('0')
    expect(value('Possible duplicates')).toHaveTextContent('1')
    expect(value('To review or can’t be imported')).toHaveTextContent('1')
    expect(value('Can’t be selected (includes rows to review)')).toHaveTextContent('1')

    expect(screen.getByRole('radio', { name: 'All (5)' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'To review (1)' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Possible duplicates (1)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Deposit rows (1)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Selected (1)' })).toBeInTheDocument()
    expect(screen.getByText('Showing 5 of 5 rows')).toBeInTheDocument()
  })

  it('filters rows without changing selection and keeps hidden drafts', async () => {
    const user = userEvent.setup()
    const state = importState()
    render(<ImportPreviewPanel importState={state} />)

    await user.type(within(tableRegion()).getByLabelText(/^Expense description for CAFE ONE/), ' latte')
    await user.click(screen.getByRole('radio', { name: 'Possible duplicates (1)' }))

    const table = tableRegion()
    expect(within(table).getByText('CAFE DUP')).toBeInTheDocument()
    expect(within(table).queryByText('CAFE TWO')).not.toBeInTheDocument()
    // The row with an unsaved draft stays visible so the edit is never hidden.
    expect(within(table).getByLabelText(/^Expense description for CAFE ONE/)).toHaveValue('Coffee latte')
    expect(screen.getByText('Showing 2 of 5 rows')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'All (5)' }))
    expect(within(tableRegion()).getByLabelText(/^Expense description for CAFE ONE/)).toHaveValue('Coffee latte')
    expect(state.updateRow).not.toHaveBeenCalled()
  })

  it('keeps a saved row visible, focused and marked Saved when it leaves the Needs attention filter', async () => {
    const user = userEvent.setup()
    const flagged = { ...e1, errors: ['invalid_transaction_amount'] }
    const rows = (first) => [first, e2, dup, dep, review]
    const { rerender } = render(<ImportPreviewPanel importState={importState({ preview: previewWith(rows(flagged)) })} />)
    const updateRow = vi.fn(async (rowId, payload) => {
      // The hook clears the flag after a successful update, so the row stops matching the filter.
      const cleared = { ...e1, ...payload, errors: [] }
      rerender(<ImportPreviewPanel importState={importState({ preview: previewWith(rows(cleared)), updateRow })} />)
      return cleared
    })
    rerender(<ImportPreviewPanel importState={importState({ preview: previewWith(rows(flagged)), updateRow })} />)

    await user.click(screen.getByRole('radio', { name: 'To review (2)' }))
    expect(within(tableRegion()).queryByText('CAFE TWO')).not.toBeInTheDocument()
    await user.type(within(tableRegion()).getByLabelText(/^Expense description for CAFE ONE/), ' latte')
    const save = within(tableRegion()).getByRole('button', { name: /^Save row/ })
    await user.click(save)

    expect(updateRow).toHaveBeenCalledTimes(1)
    const table = tableRegion()
    expect(within(table).getByText('CAFE ONE')).toBeInTheDocument()
    expect(await within(table).findByText('Saved')).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: /^Save row/ })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'To review (1)' })).toBeChecked()
  })

  it('keeps the bulk status live region rendered while empty', () => {
    render(<ImportPreviewPanel importState={importState()} />)
    const status = document.querySelector('.import-review-bulk__status')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toBeEmptyDOMElement()
  })

  it('shows an empty message when a filter matches nothing', async () => {
    const user = userEvent.setup()
    render(<ImportPreviewPanel importState={importState()} />)
    await user.click(screen.getByRole('radio', { name: 'Selected (0)' }))
    expect(screen.getByText('No rows match this filter. Filtering doesn’t change what you’ve selected.')).toBeInTheDocument()
    expect(screen.getByText('Showing 0 of 5 rows')).toBeInTheDocument()
  })

  it('shows exact separate totals in one confirm bar with one confirm button and one guidance id', () => {
    const rows = [
      { ...e1, amount: '0.1', selectedForImport: true },
      { ...e2, amount: 0.2, selectedForImport: true },
      { ...dep, selectedForInflow: true },
    ]
    const { container } = render(<ImportPreviewPanel importState={importState({ preview: previewWith(rows) })} />)
    const bar = screen.getByRole('group', { name: 'Import selected' })
    expect(within(bar).getByText('Expenses to save: 2 · $0.30')).toBeInTheDocument()
    expect(within(bar).getByText('Deposits to save: 1 · $100.00')).toBeInTheDocument()
    expect(within(bar).getByText('2 expenses and 1 deposit', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Save \d+ expenses? and/ })).toHaveLength(1)
    expect(container.querySelectorAll('#import-confirmation-guidance')).toHaveLength(1)
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(bar.textContent).not.toMatch(/net|balance|income total/i)
  })

  it('reports an unavailable total instead of guessing', () => {
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([{ ...e1, amount: '1.005', selectedForImport: true }]) })} />)
    expect(screen.getByText('Expenses to save: 1 · Total unavailable')).toBeInTheDocument()
    expect(screen.getByText('Deposits to save: 0 · $0.00')).toBeInTheDocument()
  })
})

describe('import review bulk selection', () => {
  it('selects only eligible expenses, one PATCH each, from the whole batch', async () => {
    const user = userEvent.setup()
    const state = importState()
    render(<ImportPreviewPanel importState={state} />)
    expect(selectAll()).toHaveTextContent('Select all expenses that can be imported (2)')

    await user.click(screen.getByRole('radio', { name: 'Possible duplicates (1)' }))
    await user.click(selectAll())

    expect(state.updateRow.mock.calls).toEqual([
      ['e1', { editableExpenseDescription: 'Coffee', category: 'food', selectedForImport: true, selectedForInflow: false }],
      ['e2', { editableExpenseDescription: 'Coffee', category: 'food', selectedForImport: true, selectedForInflow: false }],
    ])
    expect(await screen.findByText('Selected 2 expenses.')).toBeInTheDocument()
    expect(selectAll()).toHaveFocus()
    // Updated rows stay visible under the filter the user chose.
    expect(within(tableRegion()).getByText('CAFE ONE')).toBeInTheDocument()
  })

  it('clears every selected row including explicit duplicate and deposit picks', async () => {
    const user = userEvent.setup()
    const rows = [{ ...e1, selectedForImport: true }, { ...dup, selectedForImport: true }, { ...dep, selectedForInflow: true }, e2]
    const state = importState({ preview: previewWith(rows) })
    render(<ImportPreviewPanel importState={state} />)

    await user.click(clearSelection())

    expect(state.updateRow.mock.calls.map(([rowId]) => rowId)).toEqual(['e1', 'dup', 'dep'])
    expect(state.updateRow.mock.calls.every(([, payload]) => !payload.selectedForImport && !payload.selectedForInflow)).toBe(true)
    expect(await screen.findByText('Cleared the selection of 3 rows.')).toBeInTheDocument()
    expect(clearSelection()).toHaveFocus()
  })

  it('says so when clearing under the Selected filter empties the view', async () => {
    const user = userEvent.setup()
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([{ ...e1, selectedForImport: true }, e2]) })} />)
    await user.click(screen.getByRole('radio', { name: 'Selected (1)' }))
    await user.click(clearSelection())
    expect(await screen.findByText('Cleared the selection of 1 row. Rows no longer selected are hidden by this filter.')).toBeInTheDocument()
    expect(clearSelection()).toHaveFocus()
  })

  it('stops on the first failure and reports how far it got', async () => {
    const user = userEvent.setup()
    const updateRow = vi.fn().mockResolvedValueOnce({ ...e1, selectedForImport: true }).mockResolvedValueOnce(null)
    render(<ImportPreviewPanel importState={importState({ updateRow })} />)
    await user.click(selectAll())
    expect(await screen.findByText(/Stopped after 1 of 2 rows/)).toBeInTheDocument()
    expect(updateRow).toHaveBeenCalledTimes(2)
  })

  it('never selects a row that became a possible duplicate mid-run', async () => {
    const user = userEvent.setup()
    const first = deferred()
    const updateRow = vi.fn().mockReturnValueOnce(first.promise)
    const state = importState({ updateRow })
    const { rerender } = render(<ImportPreviewPanel importState={state} />)
    await user.click(selectAll())
    expect(screen.getByText('Updating row 1 of 2…')).toBeInTheDocument()

    const refreshed = previewWith([{ ...e1, selectedForImport: true }, { ...e2, isPossibleDuplicate: true, warnings: ['possible_duplicate'] }, dup, dep, review])
    rerender(<ImportPreviewPanel importState={{ ...state, preview: refreshed }} />)
    await act(async () => { first.resolve({ ...e1, selectedForImport: true }) })

    expect(updateRow).toHaveBeenCalledTimes(1)
    expect(updateRow.mock.calls[0][0]).toBe('e1')
    expect(await screen.findByText('Selected 1 expense.')).toBeInTheDocument()
  })

  it('uses singular wording for one row in the shown count and the stopped message', async () => {
    const user = userEvent.setup()
    const updateRow = vi.fn().mockResolvedValue(null)
    render(<ImportPreviewPanel importState={importState({ updateRow, preview: previewWith([e1]) })} />)
    expect(screen.getByText('Showing 1 of 1 row')).toBeInTheDocument()
    await user.click(selectAll())
    expect(await screen.findByText('Stopped after 0 of 1 row. Rows already updated stay as shown. Try again.')).toBeInTheDocument()
  })

  it('keeps the shown-count line static so only the bulk region announces during a run', () => {
    render(<ImportPreviewPanel importState={importState()} />)
    const showing = screen.getByText('Showing 5 of 5 rows')
    expect(showing).not.toHaveAttribute('role')
    expect(showing).not.toHaveAttribute('aria-live')
    expect(showing.closest('[role="status"], [aria-live]')).toBeNull()
    expect(document.querySelector('.import-review-bulk__status')).toHaveAttribute('role', 'status')
  })

  it('stops the loop when the external lock engages mid-run', async () => {
    const user = userEvent.setup()
    let locked = false
    const updateRow = vi.fn(async (rowId) => { locked = true; return { ...e1, rowId, selectedForImport: true } })
    render(<ImportPreviewPanel importState={importState({ updateRow })} isExternallyLocked={() => locked} />)
    await user.click(selectAll())
    expect(updateRow).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Stopped after 1 of 2 rows/)).toBeInTheDocument()
  })

  it('stops quietly when the batch changes mid-run and ignores the late response', async () => {
    const user = userEvent.setup()
    const first = deferred()
    const updateRow = vi.fn().mockReturnValueOnce(first.promise)
    const state = importState({ updateRow })
    const { rerender } = render(<ImportPreviewPanel importState={state} />)
    await user.click(selectAll())
    expect(screen.getByText('Updating row 1 of 2…')).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={{ ...state, preview: previewWith([e1, e2], '22222222-2222-2222-2222-222222222222') }} />)
    await act(async () => { first.resolve({ ...e1, selectedForImport: true }) })

    expect(updateRow).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Stopped after/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Selected \d+ expenses?\.$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Updating row/)).not.toBeInTheDocument()
  })

  it('stops without error when the preview is cleared mid-run', async () => {
    const user = userEvent.setup()
    const first = deferred()
    const updateRow = vi.fn().mockReturnValueOnce(first.promise)
    const state = importState({ updateRow })
    const { rerender } = render(<ImportPreviewPanel importState={state} />)
    await user.click(selectAll())
    rerender(<ImportPreviewPanel importState={{ ...state, preview: null, selectedCount: 0 }} />)
    await act(async () => { first.resolve({ ...e1, selectedForImport: true }) })
    expect(updateRow).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Stopped after/)).not.toBeInTheDocument()
  })

  it('locks row controls and confirmation while a bulk run is in progress', async () => {
    const user = userEvent.setup()
    const first = deferred()
    const updateRow = vi.fn().mockReturnValueOnce(first.promise)
    const state = importState({ updateRow, preview: previewWith([{ ...dep, selectedForInflow: true }, e1, e2]), selectedCount: 1 })
    render(<ImportPreviewPanel importState={state} />)
    await user.click(selectAll())

    expect(screen.getByText('Updating row 1 of 2…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save 0 expenses and 1 deposit/ })).toBeDisabled()
    expect(screen.getByText('Wait for the selection update to finish before importing.')).toBeInTheDocument()
    expect(selectAll()).toHaveAttribute('aria-disabled', 'true')
    expect(clearSelection()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Choose another statement' })).toBeDisabled()
    expect(within(tableRegion()).getByLabelText(/^Save deposit for /)).toBeDisabled()
    await user.click(selectAll())
    expect(updateRow).toHaveBeenCalledTimes(1)

    await act(async () => { first.resolve({ ...e1, selectedForImport: true }) })
    await screen.findByText(/Selected 2 expenses|Stopped after/)
  })

  it('renders bulk actions locked during an external task', () => {
    render(<ImportPreviewPanel importState={importState()} externalLocked />)
    expect(selectAll()).toBeDisabled()
    expect(clearSelection()).toBeDisabled()
  })

  it('does not run when there is nothing to do', async () => {
    const user = userEvent.setup()
    const state = importState({ preview: previewWith([dup, dep]) })
    render(<ImportPreviewPanel importState={state} />)
    expect(selectAll()).toHaveAttribute('aria-disabled', 'true')
    await user.click(selectAll())
    await user.click(clearSelection())
    expect(state.updateRow).not.toHaveBeenCalled()
  })
})

describe('import results', () => {
  const confirmation = { batchId: BATCH, status: 'confirmed', confirmedAt: '2026-08-25T21:00:00Z', importedExpenseCount: 1, importedInflowCount: 1 }
  const savedRows = {
    expenses: [{ rowId: 'e1', description: 'Coffee', category: 'food', postedDate: '2026-08-12', amount: '8.50' }],
    deposits: [{ rowId: 'dep', description: 'PAY DEPOSIT', postedDate: '2026-08-13', amount: '100.00' }],
  }
  const resultsState = (overrides = {}) => importState({ preview: null, selectedCount: 0, confirmation, confirmedRows: savedRows, ...overrides })

  it('lists the saved rows with separate exact totals outside the live region', () => {
    render(<ImportPreviewPanel importState={resultsState()} onViewActivity={vi.fn()} />)
    const list = screen.getByRole('region', { name: 'Rows saved from this review' })
    expect(within(list).getByText('Coffee')).toBeInTheDocument()
    expect(within(list).getByText(/Expense · Aug 12, 2026 · Food · \$8\.50/)).toBeInTheDocument()
    expect(within(list).getByText(/Deposit · Aug 13, 2026 · \$100\.00/)).toBeInTheDocument()
    expect(within(list).getByText('Expenses saved: 1 · $8.50')).toBeInTheDocument()
    expect(within(list).getByText('Deposits saved: 1 · $100.00')).toBeInTheDocument()
    const live = screen.getByRole('status')
    expect(live).toHaveTextContent('Import complete')
    expect(live.contains(list)).toBe(false)
    expect(live).not.toHaveTextContent('Coffee')
  })

  it('falls back to a note when the snapshot does not match the confirmed counts', () => {
    render(<ImportPreviewPanel importState={resultsState({ confirmedRows: { ...savedRows, deposits: [] } })} />)
    expect(screen.getByText('The saved rows aren’t available right now. Open Transactions to see them.')).toBeInTheDocument()
    expect(screen.queryByText('Rows saved from this review')).not.toBeInTheDocument()
    expect(screen.queryByText('Coffee')).not.toBeInTheDocument()
  })

  it('shows counts only for an already-confirmed retry', () => {
    render(<ImportPreviewPanel importState={resultsState({ confirmation: { ...confirmation, status: 'already_confirmed' }, confirmedRows: null })} />)
    expect(screen.queryByText(/saved rows is not available/)).not.toBeInTheDocument()
    expect(screen.queryByText('Rows saved from this review')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('dismisses the confirmation and hands off to Activity', async () => {
    const user = userEvent.setup()
    const state = resultsState()
    const onViewActivity = vi.fn()
    const onDone = vi.fn()
    render(<ImportPreviewPanel importState={state} onViewActivity={onViewActivity} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: 'View in Transactions' }))
    expect(state.dismissConfirmation).toHaveBeenCalledOnce()
    expect(onViewActivity).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(state.dismissConfirmation).toHaveBeenCalledTimes(2)
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('omits the Activity action when no destination is given', () => {
    render(<ImportPreviewPanel importState={resultsState()} />)
    expect(screen.queryByRole('button', { name: 'View in Transactions' })).not.toBeInTheDocument()
  })
})

describe('import review in Spanish', () => {
  beforeEach(async () => { await i18n.changeLanguage('es') })
  afterEach(async () => { await i18n.changeLanguage('en') })

  it('localizes the summary, filters, bulk actions and exact totals', async () => {
    const user = userEvent.setup()
    const state = importState({ preview: previewWith([{ ...e1, amount: '1234.5', selectedForImport: true }, e2, dup, dep, review]) })
    render(<ImportPreviewPanel importState={state} />)

    expect(screen.getByRole('region', { name: 'Resumen del estado de cuenta' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Por revisar (1)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Filas de depósito (1)' })).toBeInTheDocument()
    expect(screen.getByText('Mostrando 5 de 5 filas')).toBeInTheDocument()
    expect(screen.getByText(/^Gastos por guardar: 1 · USD\s1,234\.50$/)).toBeInTheDocument()
    expect(screen.getByText(/^Depósitos por guardar: 0 · USD\s0\.00$/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Importar seleccionados' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Seleccionar todos los gastos elegibles \(1\)/ }))
    expect(await screen.findByText('Se seleccionó 1 gasto.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Borrar selección' }))
    expect(await screen.findByText('Se borró la selección de 1 fila.')).toBeInTheDocument()
  })

  it('uses singular wording for one row and a non-repeating cleared message', async () => {
    const user = userEvent.setup()
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([{ ...e1, selectedForImport: true }]) })} />)
    expect(screen.getByText('Mostrando 1 de 1 fila')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /^Seleccionadas/ }))
    await user.click(screen.getByRole('button', { name: /^Borrar selección/ }))
    expect(await screen.findByText('Se borró la selección de 1 fila. Este filtro oculta las filas que ya no están seleccionadas.')).toBeInTheDocument()
  })

  it('localizes the saved list and actions', () => {
    const confirmation = { batchId: BATCH, status: 'confirmed', confirmedAt: '2026-08-25T21:00:00Z', importedExpenseCount: 1, importedInflowCount: 0 }
    render(<ImportPreviewPanel
      importState={importState({
        preview: null,
        selectedCount: 0,
        confirmation,
        confirmedRows: { expenses: [{ rowId: 'e1', description: 'Café', category: 'food', postedDate: '2026-08-12', amount: '8.50' }], deposits: [] },
      })}
      onViewActivity={vi.fn()}
    />)
    const list = screen.getByRole('region', { name: 'Filas guardadas de esta revisión' })
    expect(within(list).getByText(/^Gasto · 12 ago 2026 · .* · USD\s8\.50$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver en Movimientos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Listo' })).toBeInTheDocument()
  })
})
