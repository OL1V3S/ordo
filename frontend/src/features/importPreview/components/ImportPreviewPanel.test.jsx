import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ImportPreviewPanel from './ImportPreviewPanel'

const row = {
  rowId: 'row-1',
  sourceRowOrdinal: 1,
  postedDate: '2026-08-12',
  amount: 8.5,
  direction: 'debit',
  sourceDescription: 'SYNTHETIC CAFE',
  sourceSection: 'electronic_transactions',
  classification: 'expense_candidate',
  isEligible: true,
  isInflowEligible: false,
  errors: [],
  warnings: [],
  isPossibleDuplicate: false,
  isPossibleInflowDuplicate: false,
  editableExpenseDescription: 'Coffee',
  category: 'food',
  selectedForImport: true,
  selectedForInflow: false,
}

const preview = {
  batchId: '11111111-1111-1111-1111-111111111111',
  sourceType: 'sunflower_pdf',
  expiresAt: '2026-08-26T12:00:00Z',
  rows: [row],
}

function importState(overrides = {}) {
  return {
    preview,
    sourceType: 'sunflower_pdf',
    loading: false,
    processing: false,
    error: '',
    confirming: false,
    confirmation: null,
    confirmationIssue: null,
    selectedCount: 1,
    selectSource: vi.fn(),
    upload: vi.fn(),
    cancel: vi.fn(),
    updateRow: vi.fn(),
    confirm: vi.fn(),
    clearForReupload: vi.fn(),
    ...overrides,
  }
}

function tableRegion() {
  return screen.getByRole('region', { name: 'Statement import preview' })
}

describe('ImportPreviewPanel confirmation safety', () => {
  it('shares one draft across desktop and mobile presentations and blocks confirmation while dirty', async () => {
    const user = userEvent.setup()
    const state = importState()
    render(<ImportPreviewPanel importState={state} />)
    const table = tableRegion()
    const card = screen.getByRole('article', { name: 'Statement row 1' })

    await user.clear(within(table).getByLabelText('Expense description'))
    await user.type(within(table).getByLabelText('Expense description'), 'Morning coffee')

    expect(within(card).getByLabelText('Expense description')).toHaveValue('Morning coffee')
    expect(within(table).getByRole('status')).toHaveTextContent('Unsaved changes')
    expect(screen.getByText('Save every row with unsaved changes before confirming.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm 1 selected row' })).toBeDisabled()
    expect(state.confirm).not.toHaveBeenCalled()
  })

  it('announces saving, saved, and dirty-again states while preventing a PATCH/confirm race', async () => {
    const user = userEvent.setup()
    let resolveUpdate
    const updateRow = vi.fn().mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    const state = importState({ updateRow })
    render(<ImportPreviewPanel importState={state} />)
    const table = tableRegion()
    const description = within(table).getByLabelText('Expense description')

    await user.clear(description)
    await user.type(description, 'Morning coffee')
    await user.click(within(table).getByRole('button', { name: 'Save row' }))

    expect(within(table).getByRole('status')).toHaveTextContent('Saving…')
    expect(screen.getByRole('button', { name: 'Confirm 1 selected row' })).toBeDisabled()
    expect(updateRow).toHaveBeenCalledWith('row-1', {
      editableExpenseDescription: 'Morning coffee',
      category: 'food',
      selectedForImport: true,
      selectedForInflow: false,
    })

    await act(async () => {
      resolveUpdate({ ...row, editableExpenseDescription: 'Morning coffee' })
    })
    expect(within(table).getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('button', { name: 'Confirm 1 selected row' })).toBeEnabled()

    await user.type(description, ' again')
    expect(within(table).getByRole('status')).toHaveTextContent('Unsaved changes')
    expect(screen.getByRole('button', { name: 'Confirm 1 selected row' })).toBeDisabled()
  })

  it('keeps a failed save draft visible and customer-readable', async () => {
    const user = userEvent.setup()
    const state = importState({ updateRow: vi.fn().mockResolvedValue(null) })
    render(<ImportPreviewPanel importState={state} />)
    const table = tableRegion()
    const description = within(table).getByLabelText('Expense description')

    await user.clear(description)
    await user.type(description, 'Unsaved coffee')
    await user.click(within(table).getByRole('button', { name: 'Save row' }))

    expect(await within(table).findByRole('alert')).toHaveTextContent('Save failed. Changes remain unsaved.')
    expect(description).toHaveValue('Unsaved coffee')
    expect(screen.getByRole('button', { name: 'Confirm 1 selected row' })).toBeDisabled()
  })

  it('tracks selection PATCH state before enabling confirmation', async () => {
    const user = userEvent.setup()
    let resolveUpdate
    const updateRow = vi.fn().mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    render(<ImportPreviewPanel importState={importState({ updateRow })} />)
    const table = tableRegion()

    await user.click(within(table).getByLabelText('Select for import'))

    expect(within(table).getByLabelText('Select for import')).toBeDisabled()
    expect(within(table).getByRole('status')).toHaveTextContent('Saving…')
    expect(screen.getByRole('button', { name: 'Confirm 1 selected row' })).toBeDisabled()

    await act(async () => { resolveUpdate({ ...row, selectedForImport: false }) })
    expect(within(table).getByRole('status')).toHaveTextContent('Saved')
  })

  it('shows one accessible responsive confirmation action and clear zero-selection guidance', () => {
    render(<ImportPreviewPanel importState={importState({ selectedCount: 0 })} />)

    const buttons = screen.getAllByRole('button', { name: 'Confirm selected rows' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toBeDisabled()
    expect(buttons[0]).toHaveAttribute('aria-describedby', 'import-confirmation-guidance')
    expect(buttons[0]).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByText('Select at least one eligible row to import.')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('region', { name: 'Statement import preview' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Statement row 1' })).toBeInTheDocument()
  })

  it('prevents duplicate UI submits while confirmation is in flight', async () => {
    const state = importState({ confirming: true })
    render(<ImportPreviewPanel importState={state} />)

    const button = screen.getByRole('button', { name: 'Confirming selected rows…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(within(tableRegion()).getByLabelText('Select for import')).toBeDisabled()
  })

  it('refreshes ordinary Expenses only after a successful confirmation result', async () => {
    const user = userEvent.setup()
    const confirmation = {
      batchId: preview.batchId,
      status: 'confirmed',
      confirmedAt: '2026-08-25T21:00:00Z',
      importedExpenseCount: 1,
      importedInflowCount: 0,
    }
    const confirm = vi.fn().mockResolvedValue(confirmation)
    const onImportConfirmed = vi.fn().mockResolvedValue(undefined)
    render(<ImportPreviewPanel importState={importState({ confirm })} onImportConfirmed={onImportConfirmed} />)

    await user.click(screen.getByRole('button', { name: 'Confirm 1 selected row' }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(onImportConfirmed).toHaveBeenCalledOnce()
  })

  it('does not refresh Expenses after a failed confirmation result', async () => {
    const user = userEvent.setup()
    const onImportConfirmed = vi.fn()
    render(
      <ImportPreviewPanel
        importState={importState({ confirm: vi.fn().mockResolvedValue(null) })}
        onImportConfirmed={onImportConfirmed}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Confirm 1 selected row' }))

    expect(onImportConfirmed).not.toHaveBeenCalled()
  })

  it('keeps durable success distinct from a failed Transactions refresh', async () => {
    const user = userEvent.setup()
    const result = {
      batchId: preview.batchId,
      status: 'already_confirmed',
      confirmedAt: '2026-08-25T21:00:00Z',
      importedExpenseCount: 1,
      importedInflowCount: 0,
    }
    const state = importState({ confirm: vi.fn().mockResolvedValue(result) })
    const { rerender } = render(
      <ImportPreviewPanel importState={state} onImportConfirmed={vi.fn().mockRejectedValue(new Error('offline'))} />,
    )

    await user.click(screen.getByRole('button', { name: 'Confirm 1 selected row' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The import succeeded, but Transactions could not be refreshed')

    rerender(<ImportPreviewPanel importState={importState({
      preview: null,
      selectedCount: 0,
      confirmation: result,
    })} />)
    expect(screen.getByRole('heading', { name: 'Statement already imported' })).toBeInTheDocument()
    expect(screen.getByText(/1 expense and 0 incoming deposits were already saved/)).toBeInTheDocument()
  })

  it('shows safe row-level duplicate guidance and blocks a stale review', () => {
    render(<ImportPreviewPanel importState={importState({
      confirmationIssue: {
        code: 'duplicate_review_required',
        message: 'New duplicate warnings were saved, but the latest preview could not be loaded. Refresh this page before confirming.',
        rows: [{ rowId: 'row-1', codes: ['possible_duplicate'] }],
        requiresPreviewRefresh: true,
      },
    })} />)

    expect(screen.getByRole('heading', { name: 'Review new duplicate warnings' })).toBeInTheDocument()
    expect(within(tableRegion()).getByText(/New possible duplicate/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm 1 selected row' })).toBeDisabled()
    expect(screen.getByText(/Refresh this page to load the authoritative duplicate review/)).toBeInTheDocument()
  })

  it('offers a separate default-off incoming-deposit evidence control without expense fields', async () => {
    const user = userEvent.setup()
    const credit = {
      ...row,
      rowId: 'credit-1',
      direction: 'credit',
      classification: 'non_expense',
      sourceDescription: 'SYNTHETIC DEPOSIT',
      isEligible: false,
      isInflowEligible: true,
      editableExpenseDescription: null,
      category: null,
      selectedForImport: false,
      selectedForInflow: false,
    }
    const updateRow = vi.fn().mockResolvedValue({ ...credit, selectedForInflow: true })
    render(<ImportPreviewPanel importState={importState({
      preview: { ...preview, rows: [credit] },
      selectedCount: 0,
      updateRow,
    })} />)
    const table = tableRegion()

    expect(within(table).queryByLabelText('Expense description')).not.toBeInTheDocument()
    expect(within(table).getByText(/does not classify it as income or a paycheck/)).toBeInTheDocument()
    await user.click(within(table).getByLabelText('Save incoming deposit as inflow evidence'))

    expect(updateRow).toHaveBeenCalledWith('credit-1', {
      editableExpenseDescription: null,
      category: null,
      selectedForImport: false,
      selectedForInflow: true,
    })
  })
})
