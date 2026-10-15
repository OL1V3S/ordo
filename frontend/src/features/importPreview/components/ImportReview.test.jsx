import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportPreviewPanel from './ImportPreviewPanel'
import i18n from '../../../shared/localization/i18n'

// Deposit rows read paychecks and deposits for suggestions; keep these tests off the network.
vi.mock('../../paychecks/api/paychecksApi', () => ({ paychecksApi: { getPaychecks: vi.fn().mockRejectedValue(new Error('unavailable')) } }))
vi.mock('../../inflows/api/inflowsApi', () => ({ inflowsApi: { getAll: vi.fn().mockRejectedValue(new Error('unavailable')) } }))

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
    // One request per bulk action; the real hook replaces the preview from the server response.
    bulkSelection: vi.fn(async (action, rowIds) => ({ status: 'done', count: rowIds.length, changedRowIds: rowIds })),
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
const selectAll = () => screen.getByRole('button', { name: /^Select all expenses that can be imported/ })
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

  it('moves unreadable lines out of the table into a collapsed note and keeps counting them', async () => {
    const unreadable = { ...base, rowId: 'u1', sourceRowOrdinal: 6, postedDate: null, amount: null, sourceDescription: '', classification: 'invalid', isEligible: false, errors: ['unsupported_transaction_row'] }
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([e1, unreadable]) })} />)
    const note = screen.getByText('1 line couldn’t be read').closest('details')
    expect(note).not.toHaveAttribute('open')
    expect(within(note).getByText(/might include transactions/)).toBeInTheDocument()
    expect(within(note).getByText(/Statement row 6, Electronic transactions/)).toBeInTheDocument()
    expect(within(tableRegion()).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(tableRegion()).queryByText(/Statement row 6/)).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 1 row')).toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Statement summary' })
    expect(within(summary).getByText('To review or can’t be imported', { selector: 'dt' }).nextSibling).toHaveTextContent('1')
    expect(screen.getByRole('radio', { name: 'To review (1)' })).toBeInTheDocument()
  })

  it('shows no unreadable note when every row is readable', () => {
    render(<ImportPreviewPanel importState={importState()} />)
    expect(screen.queryByText(/couldn’t be read/)).not.toBeInTheDocument()
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
    const bar = screen.getByRole('group', { name: 'Rows to import' })
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
  const region = () => document.querySelector('.import-review-bulk__status')

  it('selects the eligible expenses from the whole batch with one request', async () => {
    const user = userEvent.setup()
    const state = importState()
    render(<ImportPreviewPanel importState={state} />)
    expect(selectAll()).toHaveTextContent('Select all expenses that can be imported (2)')

    await user.click(screen.getByRole('radio', { name: 'Possible duplicates (1)' }))
    await user.click(selectAll())

    expect(state.bulkSelection).toHaveBeenCalledTimes(1)
    expect(state.bulkSelection).toHaveBeenCalledWith('select_expenses', ['e1', 'e2'])
    expect(state.updateRow).not.toHaveBeenCalled()
    expect(await screen.findByText('Selected 2 expenses.')).toBeInTheDocument()
    expect(selectAll()).toHaveFocus()
    // Updated rows stay visible under the filter the user chose.
    expect(within(tableRegion()).getByText('CAFE ONE')).toBeInTheDocument()
    expect(within(tableRegion()).getAllByText('Saved')).toHaveLength(2)
  })

  it('clears every selected row, including explicit duplicate and deposit picks, with one request', async () => {
    const user = userEvent.setup()
    const rows = [{ ...e1, selectedForImport: true }, { ...dup, selectedForImport: true }, { ...dep, selectedForInflow: true }, e2]
    const state = importState({ preview: previewWith(rows) })
    render(<ImportPreviewPanel importState={state} />)

    await user.click(clearSelection())

    expect(state.bulkSelection).toHaveBeenCalledTimes(1)
    expect(state.bulkSelection).toHaveBeenCalledWith('clear', ['e1', 'dup', 'dep'])
    expect(state.updateRow).not.toHaveBeenCalled()
    expect(await screen.findByText('Cleared the selection of 3 rows.')).toBeInTheDocument()
    expect(clearSelection()).toHaveFocus()
  })

  it('reports the count the server confirms, not the number of rows listed', async () => {
    const user = userEvent.setup()
    const bulkSelection = vi.fn(async () => ({ status: 'done', count: 1, changedRowIds: ['e1'] }))
    render(<ImportPreviewPanel importState={importState({ bulkSelection })} />)
    await user.click(selectAll())
    expect(await screen.findByText('Selected 1 expense.')).toBeInTheDocument()
  })

  it('says so when clearing under the Selected filter empties the view', async () => {
    const user = userEvent.setup()
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([{ ...e1, selectedForImport: true }, e2]) })} />)
    await user.click(screen.getByRole('radio', { name: 'Selected (1)' }))
    await user.click(clearSelection())
    expect(await screen.findByText('Cleared the selection of 1 row. This filter hides rows that are no longer selected.')).toBeInTheDocument()
    expect(clearSelection()).toHaveFocus()
  })

  it('keeps the cleared rows pinned unless the Selected filter is active', async () => {
    const user = userEvent.setup()
    const selectedRows = [{ ...e1, selectedForImport: true }, e2]
    const state = importState({ preview: previewWith(selectedRows) })
    const { rerender } = render(<ImportPreviewPanel importState={state} />)
    await user.click(screen.getByRole('radio', { name: 'Selected (1)' }))
    expect(within(tableRegion()).queryByText('CAFE TWO')).not.toBeInTheDocument()
    // Selecting under the Selected filter pins the targets so the changed rows stay visible.
    const bulkSelection = vi.fn(async () => {
      rerender(<ImportPreviewPanel importState={importState({ preview: previewWith([{ ...e1, selectedForImport: true }, { ...e2, selectedForImport: true }]), bulkSelection })} />)
      return { status: 'done', count: 1, changedRowIds: ['e2'] }
    })
    rerender(<ImportPreviewPanel importState={importState({ preview: previewWith(selectedRows), bulkSelection })} />)
    await user.click(selectAll())
    expect(await screen.findByText('Selected 1 expense.')).toBeInTheDocument()
    expect(within(tableRegion()).getByText('CAFE TWO')).toBeInTheDocument()
  })

  it('announces one count at the start and one outcome at the end, with no n of N', async () => {
    const user = userEvent.setup()
    const run = deferred()
    const seen = []
    const observer = new MutationObserver(() => seen.push(region().textContent))
    const bulkSelection = vi.fn().mockReturnValueOnce(run.promise)
    render(<ImportPreviewPanel importState={importState({ bulkSelection })} />)
    observer.observe(region(), { childList: true, characterData: true, subtree: true })

    await user.click(selectAll())
    expect(region()).toHaveTextContent(/^Selecting 2 expenses…$/)
    expect(region().textContent).not.toMatch(/\bof\b|Updating row/)
    await act(async () => { run.resolve({ status: 'done', count: 2, changedRowIds: ['e1', 'e2'] }) })
    expect(region()).toHaveTextContent(/^Selected 2 expenses\.$/)
    observer.disconnect()

    expect(seen.filter(Boolean)).toEqual(['Selecting 2 expenses…', 'Selected 2 expenses.'])
    expect(bulkSelection).toHaveBeenCalledTimes(1)
  })

  it('uses count-based wording while clearing, in the singular too', async () => {
    const user = userEvent.setup()
    const run = deferred()
    const bulkSelection = vi.fn().mockReturnValueOnce(run.promise)
    render(<ImportPreviewPanel importState={importState({ bulkSelection, preview: previewWith([{ ...e1, selectedForImport: true }, e2]) })} />)
    await user.click(clearSelection())
    expect(region()).toHaveTextContent(/^Clearing the selection of 1 row…$/)
    await act(async () => { run.resolve({ status: 'done', count: 1, changedRowIds: ['e1'] }) })
    expect(region()).toHaveTextContent(/^Cleared the selection of 1 row\.$/)
  })

  it('reports a definite failure as nothing changed, with no stopped state', async () => {
    const user = userEvent.setup()
    const bulkSelection = vi.fn(async () => ({ status: 'failed' }))
    render(<ImportPreviewPanel importState={importState({ bulkSelection, preview: previewWith([{ ...dep, selectedForInflow: true }, e1, e2]), selectedCount: 1 })} />)
    await user.click(selectAll())

    expect(await screen.findByText('Nothing was changed. Try again.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/stopped|Stopped|Updating row/i)
    expect(bulkSelection).toHaveBeenCalledTimes(1)
    // A definite failure leaves the review usable.
    expect(selectAll()).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: /^Save 0 expenses and 1 deposit/ })).toBeEnabled()
  })

  it('keeps confirm locked with refresh guidance when the outcome stays uncertain', async () => {
    const user = userEvent.setup()
    const message = 'We couldn’t confirm whether the selection changed. Refresh the page to see what’s saved before importing.'
    const issue = { code: 'selection_uncertain', message, rows: [], requiresPreviewRefresh: true }
    const rows = [{ ...dep, selectedForInflow: true }, e1, e2]
    const { rerender } = render(<ImportPreviewPanel importState={importState({ preview: previewWith(rows), selectedCount: 1 })} />)
    const bulkSelection = vi.fn(async () => {
      // The hook sets the issue before it resolves.
      rerender(<ImportPreviewPanel importState={importState({ preview: previewWith(rows), selectedCount: 1, confirmationIssue: issue, bulkSelection })} />)
      return { status: 'uncertain' }
    })
    rerender(<ImportPreviewPanel importState={importState({ preview: previewWith(rows), selectedCount: 1, bulkSelection })} />)
    await user.click(selectAll())

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(bulkSelection).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /^Save 0 expenses and 1 deposit/ })).toBeDisabled()
    expect(screen.getByText('Refresh the page to see what’s saved before importing.')).toBeInTheDocument()
    expect(screen.queryByText('Refresh the page to get the latest duplicate check before importing.')).not.toBeInTheDocument()
    expect(selectAll()).toBeDisabled()
    expect(clearSelection()).toBeDisabled()
    expect(within(tableRegion()).getByLabelText(/^Save deposit for /)).toBeDisabled()
    expect(region()).toBeEmptyDOMElement()
    expect(document.body.textContent).not.toMatch(/Nothing was changed|stopped/i)
  })

  it('moves keyboard focus to the alert heading when the outcome stays uncertain', async () => {
    const user = userEvent.setup()
    const issue = { code: 'selection_uncertain', message: 'Refresh the page to see what’s saved before importing.', rows: [], requiresPreviewRefresh: true }
    const rows = [e1, e2]
    const { rerender } = render(<ImportPreviewPanel importState={importState({ preview: previewWith(rows) })} />)
    const bulkSelection = vi.fn(async () => {
      rerender(<ImportPreviewPanel importState={importState({ preview: previewWith(rows), confirmationIssue: issue, bulkSelection })} />)
      return { status: 'uncertain' }
    })
    rerender(<ImportPreviewPanel importState={importState({ preview: previewWith(rows), bulkSelection })} />)
    await user.click(selectAll())
    // The focused button is now natively disabled; focus must not fall back to the page body.
    expect(selectAll()).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Import not confirmed' })).toHaveFocus())
  })

  it('moves keyboard focus to the alert heading when the preview becomes unavailable', async () => {
    const user = userEvent.setup()
    const issue = { code: 'preview_unavailable', message: 'This preview isn’t available. Choose your bank and upload the statement again.', rows: [] }
    const { rerender } = render(<ImportPreviewPanel importState={importState()} />)
    const bulkSelection = vi.fn(async () => {
      // The review section unmounts: the hook clears the preview and sets the issue.
      rerender(<ImportPreviewPanel importState={importState({ preview: null, confirmationIssue: issue, bulkSelection })} />)
      return { status: 'unavailable' }
    })
    rerender(<ImportPreviewPanel importState={importState({ bulkSelection })} />)
    await user.click(selectAll())
    expect(screen.queryByRole('button', { name: /^Select all expenses/ })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview unavailable' })).toHaveFocus())
  })

  it('shows no outcome when the preview becomes unavailable', async () => {
    const user = userEvent.setup()
    const bulkSelection = vi.fn(async () => ({ status: 'unavailable' }))
    render(<ImportPreviewPanel importState={importState({ bulkSelection })} />)
    await user.click(selectAll())
    expect(bulkSelection).toHaveBeenCalledTimes(1)
    expect(region()).toBeEmptyDOMElement()
    expect(screen.queryByText(/Nothing was changed/)).not.toBeInTheDocument()
  })

  it('keeps the shown-count line static so only the bulk region announces during a run', () => {
    render(<ImportPreviewPanel importState={importState()} />)
    const showing = screen.getByText('Showing 5 of 5 rows')
    expect(showing).not.toHaveAttribute('role')
    expect(showing).not.toHaveAttribute('aria-live')
    expect(showing.closest('[role="status"], [aria-live]')).toBeNull()
    expect(region()).toHaveAttribute('role', 'status')
  })

  it('does not send the request when the external lock is engaged at click time', async () => {
    const user = userEvent.setup()
    const state = importState()
    render(<ImportPreviewPanel importState={state} isExternallyLocked={() => true} />)
    await user.click(selectAll())
    expect(state.bulkSelection).not.toHaveBeenCalled()
    expect(region()).toBeEmptyDOMElement()
  })

  it('ignores the late response and stays quiet when the batch changes mid-run', async () => {
    const user = userEvent.setup()
    const run = deferred()
    const bulkSelection = vi.fn().mockReturnValueOnce(run.promise)
    const state = importState({ bulkSelection })
    const { rerender } = render(<ImportPreviewPanel importState={state} />)
    await user.click(selectAll())
    expect(screen.getByText('Selecting 2 expenses…')).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={{ ...state, preview: previewWith([e1, e2], '22222222-2222-2222-2222-222222222222') }} />)
    await act(async () => { run.resolve({ status: 'done', count: 2, changedRowIds: ['e1', 'e2'] }) })

    expect(bulkSelection).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/^Selected \d+ expenses?\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/Selecting/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Nothing was changed|Stopped/)).not.toBeInTheDocument()
  })

  it('stays quiet when the preview is cleared mid-run', async () => {
    const user = userEvent.setup()
    const run = deferred()
    const bulkSelection = vi.fn().mockReturnValueOnce(run.promise)
    const state = importState({ bulkSelection })
    const { rerender } = render(<ImportPreviewPanel importState={state} />)
    await user.click(selectAll())
    rerender(<ImportPreviewPanel importState={{ ...state, preview: null, selectedCount: 0 }} />)
    await act(async () => { run.resolve({ status: 'done', count: 2, changedRowIds: ['e1', 'e2'] }) })
    expect(bulkSelection).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Stopped|Selected \d+ expense/)).not.toBeInTheDocument()
  })

  it('locks row controls and confirmation while the request is in flight', async () => {
    const user = userEvent.setup()
    const run = deferred()
    const bulkSelection = vi.fn().mockReturnValueOnce(run.promise)
    const state = importState({ bulkSelection, preview: previewWith([{ ...dep, selectedForInflow: true }, e1, e2]), selectedCount: 1 })
    render(<ImportPreviewPanel importState={state} />)
    await user.click(selectAll())

    expect(screen.getByText('Selecting 2 expenses…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save 0 expenses and 1 deposit/ })).toBeDisabled()
    expect(screen.getByText('Wait for the selection update to finish before importing.')).toBeInTheDocument()
    expect(selectAll()).toHaveAttribute('aria-disabled', 'true')
    expect(clearSelection()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Choose another statement' })).toBeDisabled()
    expect(within(tableRegion()).getByLabelText(/^Save deposit for /)).toBeDisabled()
    await user.click(selectAll())
    await user.click(clearSelection())
    expect(bulkSelection).toHaveBeenCalledTimes(1)

    await act(async () => { run.resolve({ status: 'done', count: 2, changedRowIds: ['e1', 'e2'] }) })
    await screen.findByText('Selected 2 expenses.')
  })

  it('is inert while a single-row update is in flight', async () => {
    const user = userEvent.setup()
    const rowUpdate = deferred()
    const updateRow = vi.fn().mockReturnValueOnce(rowUpdate.promise)
    const state = importState({ updateRow })
    render(<ImportPreviewPanel importState={state} />)

    await user.click(within(tableRegion()).getAllByRole('checkbox')[0])
    expect(updateRow).toHaveBeenCalledTimes(1)
    expect(selectAll()).toHaveAttribute('aria-disabled', 'true')
    expect(clearSelection()).toHaveAttribute('aria-disabled', 'true')
    await user.click(selectAll())
    expect(state.bulkSelection).not.toHaveBeenCalled()

    await act(async () => { rowUpdate.resolve({ ...e1, selectedForImport: true }) })
    expect(selectAll()).not.toHaveAttribute('aria-disabled', 'true')
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
    expect(state.bulkSelection).not.toHaveBeenCalled()
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
    expect(screen.getByRole('group', { name: 'Filas por importar' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Seleccionar todos los gastos que se pueden importar \(1\)/ }))
    expect(await screen.findByText('Se seleccionó 1 gasto.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Borrar selección' }))
    expect(await screen.findByText('Se borró la selección de 1 fila.')).toBeInTheDocument()
  })

  it('localizes the count progress, the definite failure and the uncertain guidance', async () => {
    const user = userEvent.setup()
    const run = deferred()
    const bulkSelection = vi.fn().mockReturnValueOnce(run.promise).mockResolvedValueOnce({ status: 'failed' })
    render(<ImportPreviewPanel importState={importState({ bulkSelection, preview: previewWith([{ ...e1, selectedForImport: true }, e2, dup, dep, review]) })} />)

    await user.click(screen.getByRole('button', { name: /^Seleccionar todos los gastos/ }))
    expect(screen.getByText('Seleccionando 1 gasto…')).toBeInTheDocument()
    await act(async () => { run.resolve({ status: 'done', count: 1, changedRowIds: ['e2'] }) })
    expect(await screen.findByText('Se seleccionó 1 gasto.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Borrar selección' }))
    expect(await screen.findByText('No se cambió nada. Inténtalo de nuevo.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Se detuvo|Actualizando fila/)
  })

  it('localizes the uncertain-outcome lock', () => {
    const issue = {
      code: 'selection_uncertain',
      message: 'No pudimos confirmar si la selección cambió. Actualiza la página para ver lo que está guardado antes de importar.',
      rows: [],
      requiresPreviewRefresh: true,
    }
    render(<ImportPreviewPanel importState={importState({ confirmationIssue: issue, preview: previewWith([{ ...e1, selectedForImport: true }, e2]) })} />)
    expect(screen.getByText(issue.message)).toBeInTheDocument()
    expect(screen.getByText('Actualiza la página para ver lo que está guardado antes de importar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Borrar selección' })).toBeDisabled()
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
