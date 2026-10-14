import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importPreviewApi } from '../api/importPreviewApi'
import { useImportPreview } from './useImportPreview'
import '../../../shared/localization/i18n'

vi.mock('../api/importPreviewApi', () => ({ importPreviewApi: {
  getOpen: vi.fn(), getById: vi.fn(), upload: vi.fn(), updateRow: vi.fn(), updateSelection: vi.fn(), confirm: vi.fn(),
} }))

const row = (rowId, overrides = {}) => ({
  rowId,
  postedDate: '2026-08-12',
  amount: '8.50',
  sourceDescription: ` Source ${rowId} `,
  isEligible: true,
  isInflowEligible: false,
  selectedForImport: false,
  selectedForInflow: false,
  editableExpenseDescription: `Coffee ${rowId}`,
  category: 'food',
  ...overrides,
})

const preview = {
  batchId: '11111111-1111-1111-1111-111111111111',
  sourceType: 'sunflower_pdf',
  expiresAt: '2026-08-21T12:00:00Z',
  rows: [
    row('e1', { selectedForImport: true }),
    row('e2'),
    row('d1', { isEligible: false, isInflowEligible: true, selectedForInflow: true, amount: '100.00', editableExpenseDescription: null, category: null }),
  ],
}

const confirmed = {
  batchId: preview.batchId,
  status: 'confirmed',
  confirmedAt: '2026-08-25T21:00:00Z',
  importedExpenseCount: 1,
  importedInflowCount: 1,
}

async function loadedHook() {
  window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
  importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
  const hook = renderHook(() => useImportPreview())
  await waitFor(() => expect(hook.result.current.preview).toEqual(preview))
  return hook
}

describe('useImportPreview review additions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/transactions')
    importPreviewApi.getOpen.mockResolvedValue({ status: 204, data: null })
  })

  it('snapshots the saved rows from the preview at confirm time', async () => {
    importPreviewApi.confirm.mockResolvedValue({ status: 200, data: confirmed })
    const { result } = await loadedHook()
    expect(result.current.confirmedRows).toBeNull()

    await act(async () => { await result.current.confirm() })

    expect(result.current.preview).toBeNull()
    expect(result.current.confirmedRows).toEqual({
      expenses: [{ rowId: 'e1', description: 'Coffee e1', category: 'food', postedDate: '2026-08-12', amount: '8.50' }],
      deposits: [{ rowId: 'd1', description: 'Source d1', postedDate: '2026-08-12', amount: '100.00' }],
    })
  })

  it('clears the snapshot and confirmation on dismiss', async () => {
    importPreviewApi.confirm.mockResolvedValue({ status: 200, data: confirmed })
    const { result } = await loadedHook()
    await act(async () => { await result.current.confirm() })

    act(() => result.current.dismissConfirmation())

    expect(result.current.confirmation).toBeNull()
    expect(result.current.confirmedRows).toBeNull()
  })

  it('clears the snapshot when another source is selected or a new file is uploaded', async () => {
    importPreviewApi.confirm.mockResolvedValue({ status: 200, data: confirmed })
    const { result } = await loadedHook()
    await act(async () => { await result.current.confirm() })
    await act(async () => { await result.current.selectSource('sunflower_pdf') })
    expect(result.current.confirmedRows).toBeNull()

    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    importPreviewApi.upload.mockResolvedValue({ status: 200, data: preview })
    await act(async () => { await result.current.upload(new File(['pdf'], 'statement.pdf')) })
    await act(async () => { await result.current.confirm() })
    expect(result.current.confirmedRows).not.toBeNull()
    await act(async () => { await result.current.upload(new File(['pdf'], 'statement.pdf')) })
    expect(result.current.confirmedRows).toBeNull()
    expect(result.current.confirmation).toBeNull()
  })

  it('leaves the snapshot empty when confirmation fails', async () => {
    importPreviewApi.confirm.mockRejectedValue({ response: { status: 500, data: {} } })
    const { result } = await loadedHook()

    await act(async () => { await result.current.confirm() })

    expect(result.current.confirmedRows).toBeNull()
    expect(result.current.confirmation).toBeNull()
    expect(result.current.preview).toEqual(preview)
    expect(result.current.confirmationIssue.code).toBe('confirmation_failed')
  })

  it('ignores a row update response that arrives after the preview was cleared', async () => {
    let resolveUpdate
    importPreviewApi.updateRow.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    const { result } = await loadedHook()

    let pending
    act(() => { pending = result.current.updateRow('e2', { selectedForImport: true }) })
    act(() => result.current.clearForReupload())
    await act(async () => { resolveUpdate({ data: row('e2', { selectedForImport: true }) }); await pending })

    expect(result.current.preview).toBeNull()
  })
})

describe('useImportPreview bulk selection', () => {
  const selected = {
    ...preview,
    rows: [row('e1', { selectedForImport: true }), row('e2', { selectedForImport: true }), preview.rows[2]],
  }
  const selectedResponse = { data: { preview: selected, changedRowIds: ['e2'] } }
  const cleared = {
    ...preview,
    rows: [row('e1'), row('e2'), { ...preview.rows[2], selectedForInflow: false }],
  }
  const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/transactions')
    importPreviewApi.getOpen.mockResolvedValue({ status: 204, data: null })
  })

  it('sends one request, replaces the preview from the response and reports the count', async () => {
    importPreviewApi.updateSelection.mockResolvedValue(selectedResponse)
    const { result } = await loadedHook()

    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e2']) })

    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(1)
    expect(importPreviewApi.updateSelection).toHaveBeenCalledWith(preview.batchId, 'select_expenses', ['e2'])
    expect(importPreviewApi.updateRow).not.toHaveBeenCalled()
    expect(importPreviewApi.getById).toHaveBeenCalledTimes(1)
    expect(result.current.preview).toEqual(selected)
    expect(result.current.selectedCount).toBe(3)
    expect(outcome).toEqual({ status: 'done', count: 1, changedRowIds: ['e2'] })
  })

  it('counts the listed rows now cleared, including a deposit', async () => {
    importPreviewApi.updateSelection.mockResolvedValue({ data: { preview: cleared, changedRowIds: ['e1', 'd1'] } })
    const { result } = await loadedHook()

    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('clear', ['e1', 'd1']) })

    expect(importPreviewApi.updateSelection).toHaveBeenCalledWith(preview.batchId, 'clear', ['e1', 'd1'])
    expect(outcome).toEqual({ status: 'done', count: 2, changedRowIds: ['e1', 'd1'] })
    expect(result.current.selectedCount).toBe(0)
  })

  it('mirrors the row update confirmation issue handling', async () => {
    importPreviewApi.confirm.mockRejectedValueOnce({ response: { status: 400, data: { code: 'no_rows_selected' } } })
    importPreviewApi.updateSelection.mockResolvedValue(selectedResponse)
    const { result } = await loadedHook()
    await act(async () => { await result.current.confirm() })
    expect(result.current.confirmationIssue.code).toBe('no_rows_selected')

    await act(async () => { await result.current.bulkSelection('select_expenses', ['e2']) })
    expect(result.current.confirmationIssue).toBeNull()

    importPreviewApi.confirm.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'confirmation_validation_failed', rows: [
        { rowId: 'e1', codes: ['description_required'] },
        { rowId: 'e2', codes: ['category_required'] },
      ] } },
    })
    await act(async () => { await result.current.confirm() })
    expect(result.current.confirmationIssue.rows.map((issue) => issue.rowId)).toEqual(['e1', 'e2'])

    importPreviewApi.updateSelection.mockResolvedValue({ data: { preview: cleared, changedRowIds: ['e1'] } })
    await act(async () => { await result.current.bulkSelection('clear', ['e1']) })
    expect(result.current.confirmationIssue.rows.map((issue) => issue.rowId)).toEqual(['e2'])
  })

  it('replays the identical request once after an uncertain outcome and uses the replay response', async () => {
    importPreviewApi.updateSelection
      .mockRejectedValueOnce({ response: { status: 504, data: {} } })
      .mockResolvedValueOnce({ data: { preview: selected, changedRowIds: [] } })
    const { result } = await loadedHook()

    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e1', 'e2']) })

    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(2)
    expect(importPreviewApi.updateSelection.mock.calls[1]).toEqual(importPreviewApi.updateSelection.mock.calls[0])
    expect(importPreviewApi.getById).toHaveBeenCalledTimes(1)
    expect(result.current.preview).toEqual(selected)
    expect(result.current.confirmationIssue).toBeNull()
    // The replay finds the first call already committed: nothing changed, yet both rows are selected.
    expect(outcome).toEqual({ status: 'done', count: 2, changedRowIds: [] })
  })

  it.each([
    ['a network error', new Error('Network Error')],
    ['a server error', { response: { status: 500, data: {} } }],
  ])('treats %s as uncertain and replays once', async (_label, failure) => {
    importPreviewApi.updateSelection.mockRejectedValueOnce(failure).mockResolvedValueOnce(selectedResponse)
    const { result } = await loadedHook()

    await act(async () => { await result.current.bulkSelection('select_expenses', ['e2']) })

    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(2)
    expect(result.current.preview).toEqual(selected)
  })

  it('treats a malformed success response as uncertain', async () => {
    importPreviewApi.updateSelection
      .mockResolvedValueOnce({ data: { preview: { batchId: 'other', rows: [] }, changedRowIds: [] } })
      .mockResolvedValueOnce(selectedResponse)
    const { result } = await loadedHook()

    await act(async () => { await result.current.bulkSelection('select_expenses', ['e2']) })

    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(2)
    expect(result.current.preview).toEqual(selected)
  })

  it('locks confirmation with refresh guidance when the replay also fails', async () => {
    importPreviewApi.updateSelection.mockRejectedValue({ response: { status: 503, data: {} } })
    const { result } = await loadedHook()

    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e2']) })

    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(2)
    expect(outcome).toEqual({ status: 'uncertain' })
    expect(result.current.preview).toEqual(preview)
    expect(result.current.confirmationIssue).toEqual({
      code: 'selection_uncertain',
      message: 'We couldn’t confirm whether the selection changed. Refresh the page to see what’s saved before importing.',
      rows: [],
      requiresPreviewRefresh: true,
    })
    expect(result.current.confirmationIssue.message).not.toMatch(/nothing (was )?(changed|saved)/i)

    // Locked: another bulk request does not start until the page is refreshed.
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e2']) })
    expect(outcome).toEqual({ status: 'ignored' })
    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(2)
  })

  it('stays locked when the replay is rejected after an uncertain first call', async () => {
    importPreviewApi.updateSelection
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce({ response: { status: 400, data: { code: 'selection_request_invalid' } } })
    const { result } = await loadedHook()

    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('clear', ['e1']) })

    expect(outcome).toEqual({ status: 'uncertain' })
    expect(result.current.confirmationIssue.requiresPreviewRefresh).toBe(true)
  })

  it('handles a 404 like an unavailable preview without a replay', async () => {
    importPreviewApi.updateSelection.mockRejectedValue({ response: { status: 404, data: {} } })
    const { result } = await loadedHook()

    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e2']) })

    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ status: 'unavailable' })
    expect(result.current.preview).toBeNull()
    expect(window.location.search).not.toContain('importBatch')
    expect(result.current.confirmationIssue.code).toBe('preview_unavailable')
    expect(result.current.confirmationIssue.requiresPreviewRefresh).toBe(false)
  })

  it('reports a definite 400 as failed with no replay and no lock', async () => {
    importPreviewApi.updateSelection.mockRejectedValue({ response: { status: 400, data: { code: 'selection_request_invalid' } } })
    const { result } = await loadedHook()

    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e2']) })

    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ status: 'failed' })
    expect(result.current.preview).toEqual(preview)
    expect(result.current.confirmationIssue).toBeNull()
    expect(result.current.error).toBe('')
  })

  it('ignores a late response after the preview was cleared and does not replay', async () => {
    const first = deferred()
    importPreviewApi.updateSelection.mockReturnValue(first.promise)
    const { result } = await loadedHook()

    let pending
    act(() => { pending = result.current.bulkSelection('select_expenses', ['e2']) })
    act(() => result.current.clearForReupload())
    let outcome
    await act(async () => { first.resolve(selectedResponse); outcome = await pending })

    expect(outcome).toEqual({ status: 'ignored' })
    expect(result.current.preview).toBeNull()
    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(1)
  })

  it('ignores an uncertain failure that arrives after the preview was cleared', async () => {
    const first = deferred()
    importPreviewApi.updateSelection.mockReturnValue(first.promise)
    const { result } = await loadedHook()

    let pending
    act(() => { pending = result.current.bulkSelection('select_expenses', ['e2']) })
    act(() => result.current.clearForReupload())
    let outcome
    await act(async () => { first.reject(new Error('Network Error')); outcome = await pending })

    expect(outcome).toEqual({ status: 'ignored' })
    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(1)
    expect(result.current.confirmationIssue).toBeNull()
  })

  it('is inert while a single row update is in flight', async () => {
    const rowUpdate = deferred()
    importPreviewApi.updateRow.mockReturnValue(rowUpdate.promise)
    importPreviewApi.updateSelection.mockResolvedValue(selectedResponse)
    const { result } = await loadedHook()

    let pendingRow
    act(() => { pendingRow = result.current.updateRow('e2', { selectedForImport: true }) })
    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e2']) })
    expect(outcome).toEqual({ status: 'ignored' })
    expect(importPreviewApi.updateSelection).not.toHaveBeenCalled()

    await act(async () => { rowUpdate.resolve({ data: row('e2', { selectedForImport: true }) }); await pendingRow })
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e2']) })
    expect(outcome.status).toBe('done')
    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(1)
  })

  it('is inert while a single row update fails and afterwards starts again', async () => {
    importPreviewApi.updateRow.mockRejectedValue({ response: { status: 500, data: {} } })
    importPreviewApi.updateSelection.mockResolvedValue(selectedResponse)
    const { result } = await loadedHook()

    await act(async () => { await result.current.updateRow('e2', { selectedForImport: true }) })
    let outcome
    await act(async () => { outcome = await result.current.bulkSelection('select_expenses', ['e2']) })

    expect(outcome.status).toBe('done')
  })

  it('starts only one bulk request at a time', async () => {
    const first = deferred()
    importPreviewApi.updateSelection.mockReturnValue(first.promise)
    const { result } = await loadedHook()

    let pending
    act(() => { pending = result.current.bulkSelection('select_expenses', ['e2']) })
    let second
    await act(async () => { second = await result.current.bulkSelection('clear', ['e1']) })
    expect(second).toEqual({ status: 'ignored' })

    await act(async () => { first.resolve(selectedResponse); await pending })
    expect(importPreviewApi.updateSelection).toHaveBeenCalledTimes(1)
  })

  it('does not start without a preview, a known action or any row ids', async () => {
    const { result } = await loadedHook()
    let outcomes
    await act(async () => {
      outcomes = [
        await result.current.bulkSelection('select_expenses', []),
        await result.current.bulkSelection('toggle', ['e2']),
        await result.current.bulkSelection('clear', undefined),
      ]
    })
    expect(outcomes).toEqual([{ status: 'ignored' }, { status: 'ignored' }, { status: 'ignored' }])
    expect(importPreviewApi.updateSelection).not.toHaveBeenCalled()
  })
})
