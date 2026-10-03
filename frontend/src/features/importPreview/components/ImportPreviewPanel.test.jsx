import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ImportPreviewPanel from './ImportPreviewPanel'
import '../../../shared/localization/i18n'

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
  it('uses one responsive row draft and blocks confirmation while dirty', async () => {
    const user = userEvent.setup()
    const state = importState()
    render(<ImportPreviewPanel importState={state} />)
    const table = tableRegion()
    const description = within(table).getByLabelText(/^Expense description for /)

    expect(screen.getAllByLabelText(/^Expense description for /)).toHaveLength(1)
    expect(description.closest('td')).toHaveAttribute('data-label', 'Expense fields')
    await user.clear(description)
    await user.type(description, 'Morning coffee')

    expect(description).toHaveValue('Morning coffee')
    expect(within(table).getByRole('status')).toHaveTextContent('Unsaved changes')
    expect(screen.getByText('Save every row with unsaved changes before confirming.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' })).toBeDisabled()
    expect(state.confirm).not.toHaveBeenCalled()
  })

  it('prevents an unsaved row draft from being discarded for another statement', async () => {
    const user = userEvent.setup()
    const state = importState()
    render(<ImportPreviewPanel importState={state} />)

    await user.type(within(tableRegion()).getByLabelText(/^Expense description for /), ' updated')

    const chooseAnother = screen.getByRole('button', { name: 'Choose another statement' })
    expect(chooseAnother).toBeDisabled()
    await user.click(chooseAnother)
    expect(state.clearForReupload).not.toHaveBeenCalled()
  })

  it('announces saving, saved, and dirty-again states while preventing a PATCH/confirm race', async () => {
    const user = userEvent.setup()
    let resolveUpdate
    const updateRow = vi.fn().mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    const state = importState({ updateRow })
    render(<ImportPreviewPanel importState={state} />)
    const table = tableRegion()
    const description = within(table).getByLabelText(/^Expense description for /)

    await user.clear(description)
    await user.type(description, 'Morning coffee')
    await user.click(within(table).getByRole('button', { name: /^Save row for / }))

    expect(within(table).getByRole('status')).toHaveTextContent('Saving…')
    expect(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' })).toBeEnabled()

    await user.type(description, ' again')
    expect(within(table).getByRole('status')).toHaveTextContent('Unsaved changes')
    expect(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' })).toBeDisabled()
  })

  it('keeps a failed save draft visible and customer-readable', async () => {
    const user = userEvent.setup()
    const state = importState({ updateRow: vi.fn().mockResolvedValue(null) })
    render(<ImportPreviewPanel importState={state} />)
    const table = tableRegion()
    const description = within(table).getByLabelText(/^Expense description for /)

    await user.clear(description)
    await user.type(description, 'Unsaved coffee')
    await user.click(within(table).getByRole('button', { name: /^Save row for / }))

    expect(await within(table).findByRole('alert')).toHaveTextContent('Save failed. Changes remain unsaved.')
    expect(description).toHaveValue('Unsaved coffee')
    expect(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' })).toBeDisabled()
  })

  it('tracks selection PATCH state before enabling confirmation', async () => {
    const user = userEvent.setup()
    let resolveUpdate
    const updateRow = vi.fn().mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    render(<ImportPreviewPanel importState={importState({ updateRow })} />)
    const table = tableRegion()

    await user.click(within(table).getByLabelText(/^Select for import for /))

    expect(within(table).getByLabelText(/^Select for import for /)).toBeDisabled()
    expect(within(table).getByRole('status')).toHaveTextContent('Saving…')
    expect(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' })).toBeDisabled()

    await act(async () => { resolveUpdate({ ...row, selectedForImport: false }) })
    expect(within(table).getByRole('status')).toHaveTextContent('Saved')
  })

  it('shows one accessible responsive confirmation action and clear zero-selection guidance', () => {
    render(<ImportPreviewPanel importState={importState({
      preview: { ...preview, rows: [{ ...row, selectedForImport: false }] },
      selectedCount: 0,
    })} />)

    const buttons = screen.getAllByRole('button', { name: 'Save 0 expenses and 0 incoming deposits' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toBeDisabled()
    expect(buttons[0]).toHaveAttribute('aria-describedby', 'import-confirmation-guidance')
    expect(buttons[0]).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByText('Select at least one eligible row to import.')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('region', { name: 'Statement import preview' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })

  it('summarizes selected expenses and incoming deposits in the single save action', () => {
    const credit = {
      ...row,
      rowId: 'credit-1',
      sourceRowOrdinal: 2,
      direction: 'credit',
      classification: 'non_expense',
      sourceDescription: 'SYNTHETIC DEPOSIT',
      isEligible: false,
      isInflowEligible: true,
      editableExpenseDescription: null,
      category: null,
      selectedForImport: false,
      selectedForInflow: true,
    }
    render(<ImportPreviewPanel importState={importState({
      preview: { ...preview, rows: [row, credit] },
      selectedCount: 2,
    })} />)

    expect(screen.getByText('1 expense and 1 incoming deposit', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save 1 expense and 1 incoming deposit' })).toBeEnabled()
  })

  it('gives repeated row controls unique names with transaction and ordinal context', () => {
    const secondRow = {
      ...row,
      rowId: 'row-2',
      sourceRowOrdinal: 2,
    }
    render(<ImportPreviewPanel importState={importState({
      preview: { ...preview, rows: [row, secondRow] },
      selectedCount: 2,
    })} />)

    expect(screen.getByRole('checkbox', { name: 'Select for import for SYNTHETIC CAFE on 2026-08-12, statement row 1' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select for import for SYNTHETIC CAFE on 2026-08-12, statement row 2' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Expense description for SYNTHETIC CAFE on 2026-08-12, statement row 1' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Category for SYNTHETIC CAFE on 2026-08-12, statement row 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save row for SYNTHETIC CAFE on 2026-08-12, statement row 1' })).toBeInTheDocument()
    expect(screen.getByLabelText('Source details for SYNTHETIC CAFE on 2026-08-12, statement row 2')).toBeInTheDocument()
  })

  it('keeps decision facts visible and puts only source mechanics in named details', async () => {
    const user = userEvent.setup()
    render(<ImportPreviewPanel importState={importState({
      preview: {
        ...preview,
        rows: [{ ...row, isPossibleDuplicate: true, warnings: ['possible_duplicate'] }],
      },
    })} />)
    const table = tableRegion()
    const sourceDetails = within(table).getByRole('group')

    expect(within(table).getByText('SYNTHETIC CAFE')).toBeVisible()
    expect(within(table).getByText('2026-08-12')).toBeVisible()
    expect(within(table).getByText('$8.50')).toBeVisible()
    expect(within(table).getByText('Debit')).toBeVisible()
    expect(within(table).getByText('Possible duplicate — review before selecting')).toBeVisible()
    expect(within(table).getByLabelText(/^Select for import for /)).toBeVisible()
    expect(sourceDetails).not.toHaveAttribute('open')

    const sourceSummary = within(table).getByText('Source details', { selector: 'summary' })
    expect(sourceSummary).toHaveAttribute('aria-label', 'Source details for SYNTHETIC CAFE on 2026-08-12, statement row 1')
    await user.click(sourceSummary)

    expect(sourceDetails).toHaveAttribute('open')
    expect(within(sourceDetails).getByText('Electronic Transactions')).toBeVisible()
    expect(within(sourceDetails).getByText('1')).toBeVisible()
  })

  it('prevents duplicate UI submits while confirmation is in flight', async () => {
    const state = importState({ confirming: true })
    render(<ImportPreviewPanel importState={state} />)

    const button = screen.getByRole('button', { name: 'Saving 1 expense and 0 incoming deposits…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(within(tableRegion()).getByLabelText(/^Select for import for /)).toBeDisabled()
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

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' }))

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

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' }))

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

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The import succeeded, but Activity could not be refreshed')

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
    expect(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' })).toBeDisabled()
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

    expect(within(table).queryByLabelText(/^Expense description for /)).not.toBeInTheDocument()
    expect(within(table).getByText(/does not classify it as income or a paycheck/)).toBeInTheDocument()
    await user.click(within(table).getByLabelText(/^Save incoming deposit for /))

    expect(updateRow).toHaveBeenCalledWith('credit-1', {
      editableExpenseDescription: null,
      category: null,
      selectedForImport: false,
      selectedForInflow: true,
    })
  })

  it('renders every statement mutation control locked during an external cash-in task', () => {
    const { rerender } = render(<ImportPreviewPanel
      importState={importState({ preview: null, sourceType: 'sunflower_pdf', selectedCount: 0 })}
      externalLocked
    />)

    expect(screen.getByLabelText('Bank')).toBeDisabled()
    expect(screen.getByLabelText('Sunflower statement PDF')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Choose PDF' })).toBeDisabled()

    rerender(<ImportPreviewPanel importState={importState()} externalLocked />)
    expect(screen.getByRole('button', { name: 'Choose another statement' })).toBeDisabled()
    expect(within(tableRegion()).getByLabelText(/^Expense description for /)).toBeDisabled()
    expect(within(tableRegion()).getByLabelText(/^Category for /)).toBeDisabled()
    expect(within(tableRegion()).getByLabelText(/^Select for import for /)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' })).toBeDisabled()
    expect(screen.getByText('Finish the cash-in task before changing the statement.')).toBeInTheDocument()
  })

  it('rechecks the external lock inside source, upload, and drop handlers', () => {
    let locked = false
    const file = new File(['statement'], 'statement.pdf', { type: 'application/pdf' })
    const state = importState({ preview: null, sourceType: 'sunflower_pdf', selectedCount: 0 })
    const { container } = render(
      <ImportPreviewPanel importState={state} isExternallyLocked={() => locked} />,
    )

    locked = true
    fireEvent.change(screen.getByLabelText('Bank'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Sunflower statement PDF'), { target: { files: [file] } })
    fireEvent.drop(container.querySelector('.import-dropzone'), { dataTransfer: { files: [file] } })

    expect(state.selectSource).not.toHaveBeenCalled()
    expect(state.upload).not.toHaveBeenCalled()
  })

  it('rechecks the external lock inside row, selection, replacement, and confirmation handlers', async () => {
    let locked = false
    const state = importState()
    const { unmount } = render(
      <ImportPreviewPanel importState={state} isExternallyLocked={() => locked} />,
    )
    const description = within(tableRegion()).getByLabelText(/^Expense description for /)

    fireEvent.change(description, { target: { value: 'Dirty before lock' } })
    expect(description).toHaveValue('Dirty before lock')
    locked = true
    fireEvent.change(description, { target: { value: 'Blocked edit' } })
    fireEvent.click(within(tableRegion()).getByRole('button', { name: /^Save row for / }))
    fireEvent.click(within(tableRegion()).getByLabelText(/^Select for import for /))
    expect(description).toHaveValue('Dirty before lock')
    expect(state.updateRow).not.toHaveBeenCalled()

    unmount()
    locked = false
    const guardedState = importState()
    render(<ImportPreviewPanel importState={guardedState} isExternallyLocked={() => locked} />)
    locked = true
    fireEvent.click(screen.getByRole('button', { name: 'Choose another statement' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' }))
    expect(guardedState.clearForReupload).not.toHaveBeenCalled()
    expect(guardedState.confirm).not.toHaveBeenCalled()
  })

  it('passes credit-only and already-confirmed result counts to the refresh callback', async () => {
    const user = userEvent.setup()
    const credit = {
      ...row,
      rowId: 'credit-only',
      direction: 'credit',
      classification: 'non_expense',
      sourceDescription: 'SYNTHETIC DEPOSIT',
      isEligible: false,
      isInflowEligible: true,
      editableExpenseDescription: null,
      category: null,
      selectedForImport: false,
      selectedForInflow: true,
    }
    const creditResult = {
      batchId: preview.batchId,
      status: 'confirmed',
      confirmedAt: '2026-08-25T21:00:00Z',
      importedExpenseCount: 0,
      importedInflowCount: 1,
    }
    const creditCallback = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(<ImportPreviewPanel
      importState={importState({
        preview: { ...preview, rows: [credit] },
        selectedCount: 1,
        confirm: vi.fn().mockResolvedValue(creditResult),
      })}
      onImportConfirmed={creditCallback}
    />)

    await user.click(screen.getByRole('button', { name: 'Save 0 expenses and 1 incoming deposit' }))
    expect(creditCallback).toHaveBeenCalledWith(creditResult)

    unmount()
    const alreadyConfirmedResult = {
      ...creditResult,
      status: 'already_confirmed',
      importedExpenseCount: 1,
      importedInflowCount: 0,
    }
    const alreadyConfirmedCallback = vi.fn().mockResolvedValue(undefined)
    render(<ImportPreviewPanel
      importState={importState({ confirm: vi.fn().mockResolvedValue(alreadyConfirmedResult) })}
      onImportConfirmed={alreadyConfirmedCallback}
    />)

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' }))
    expect(alreadyConfirmedCallback).toHaveBeenCalledWith(alreadyConfirmedResult)
  })

  it('keeps the completed import visible when one affected list refresh fails', async () => {
    const user = userEvent.setup()
    const result = {
      batchId: preview.batchId,
      status: 'confirmed',
      confirmedAt: '2026-08-25T21:00:00Z',
      importedExpenseCount: 1,
      importedInflowCount: 1,
    }
    const onImportConfirmed = vi.fn().mockResolvedValue({ failedLists: ['cashIn'] })
    const state = importState({ confirm: vi.fn().mockResolvedValue(result) })
    const { rerender } = render(
      <ImportPreviewPanel importState={state} onImportConfirmed={onImportConfirmed} />,
    )

    await user.click(screen.getByRole('button', { name: 'Save 1 expense and 0 incoming deposits' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The import succeeded, but Activity could not be refreshed for cash in')
    expect(onImportConfirmed).toHaveBeenCalledWith(result)

    rerender(<ImportPreviewPanel
      importState={importState({ preview: null, selectedCount: 0, confirmation: result })}
      onImportConfirmed={onImportConfirmed}
    />)
    expect(screen.getByRole('heading', { name: 'Import complete' })).toBeInTheDocument()
    expect(screen.getByText(/1 expense and 1 incoming deposit saved/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The import succeeded')
  })
})
