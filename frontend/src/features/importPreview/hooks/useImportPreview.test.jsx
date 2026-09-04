import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importPreviewApi } from '../api/importPreviewApi'
import { useImportPreview } from './useImportPreview'

vi.mock('../api/importPreviewApi', () => ({ importPreviewApi: {
  getOpen: vi.fn(), getById: vi.fn(), upload: vi.fn(), updateRow: vi.fn(), confirm: vi.fn(),
} }))

const preview = {
  batchId: '11111111-1111-1111-1111-111111111111',
  sourceType: 'sunflower_pdf',
  expiresAt: '2026-08-21T12:00:00Z',
  rows: [{
    rowId: 'row-1', isEligible: true, isInflowEligible: false,
    selectedForImport: false, selectedForInflow: false,
    editableExpenseDescription: 'Coffee', category: 'food',
  }],
}

const confirmed = {
  batchId: preview.batchId,
  status: 'confirmed',
  confirmedAt: '2026-08-25T21:00:00Z',
  importedExpenseCount: 1,
  importedInflowCount: 0,
}

describe('useImportPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/transactions')
    importPreviewApi.getOpen.mockResolvedValue({ status: 204, data: null })
  })

  it('resumes a deep-linked batch through the server and remembers the validated id', async () => {
    window.history.replaceState({}, '', '/transactions?importBatch=11111111-1111-1111-1111-111111111111')
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })

    const { result } = renderHook(() => useImportPreview())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(importPreviewApi.getById).toHaveBeenCalledWith(preview.batchId, expect.any(AbortSignal))
    expect(result.current.preview).toEqual(preview)
    expect(result.current.sourceType).toBe('sunflower_pdf')
    expect(window.location.search).toContain(`importBatch=${preview.batchId}`)
  })

  it('maps safe upload errors and does not expose server internals', async () => {
    importPreviewApi.upload.mockRejectedValue({
      response: { data: { code: 'encrypted_pdf', message: 'internal detail' } },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.selectSource('sunflower_pdf'))
    await act(() => result.current.upload(new File(['pdf'], 'statement.pdf')))

    expect(importPreviewApi.upload).toHaveBeenCalledWith('sunflower_pdf', expect.any(File), expect.any(AbortSignal))
    expect(result.current.error).toBe('Encrypted or password-protected PDFs are not supported.')
    expect(result.current.error).not.toContain('internal detail')
  })

  it('maps an exact already-imported upload to friendly static guidance', async () => {
    importPreviewApi.upload.mockRejectedValue({
      response: { status: 409, data: { code: 'already_imported', message: 'private server detail' } },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.selectSource('sunflower_pdf'))
    await act(() => result.current.upload(new File(['pdf'], 'statement.pdf')))

    expect(result.current.error).toBe('This statement was already imported. No duplicate financial records were created.')
    expect(result.current.error).not.toContain('private server detail')
  })

  it('persists a row update into the current preview', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    importPreviewApi.updateRow.mockResolvedValue({ data: { ...preview.rows[0], selectedForImport: true } })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.updateRow('row-1', { selectedForImport: true }))

    expect(result.current.preview.rows[0].selectedForImport).toBe(true)
  })

  it('keeps the preview unchanged when the server rejects a row mutation', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    importPreviewApi.updateRow.mockRejectedValue({
      response: { data: { code: 'row_not_selectable', message: 'internal detail' } },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.updateRow('row-1', { selectedForImport: true }))

    expect(result.current.preview).toEqual(preview)
    expect(result.current.error).toBe('That row cannot be selected for import.')
    expect(result.current.error).not.toContain('internal detail')
  })

  it('counts explicitly selected eligible incoming deposits independently of expense selection', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    const creditPreview = {
      ...preview,
      rows: [{
        ...preview.rows[0], isEligible: false, isInflowEligible: true,
        selectedForImport: false, selectedForInflow: true,
      }],
    }
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: creditPreview })
    const { result } = renderHook(() => useImportPreview())

    await waitFor(() => expect(result.current.preview).toEqual(creditPreview))
    expect(result.current.selectedCount).toBe(1)
  })

  it('requires explicit source selection before looking for an open preview', async () => {
    importPreviewApi.getOpen.mockResolvedValue({ status: 204, data: null })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(importPreviewApi.getOpen).not.toHaveBeenCalled()
    await act(() => result.current.selectSource('sunflower_pdf'))

    expect(importPreviewApi.getOpen).toHaveBeenCalledWith('sunflower_pdf', expect.any(AbortSignal))
    expect(result.current.sourceType).toBe('sunflower_pdf')
  })

  it.each(['confirmed', 'already_confirmed'])('retires the preview and preserves unrelated URL state after %s', async (status) => {
    window.history.replaceState({}, '', `/transactions?keep=yes&importBatch=${preview.batchId}#expenses`)
    const selectedPreview = {
      ...preview,
      rows: [{ ...preview.rows[0], selectedForImport: true }],
    }
    const response = { ...confirmed, status }
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: selectedPreview })
    importPreviewApi.confirm.mockResolvedValue({ status: 200, data: response })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(selectedPreview))

    let returned
    await act(async () => { returned = await result.current.confirm() })

    expect(importPreviewApi.confirm).toHaveBeenCalledWith(preview.batchId)
    expect(returned).toEqual(response)
    expect(result.current.confirmation).toEqual(response)
    expect(result.current.preview).toBeNull()
    expect(window.location.search).toBe('?keep=yes')
    expect(window.location.hash).toBe('#expenses')
  })

  it('guards same-tick duplicate confirmation calls', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    const selectedPreview = {
      ...preview,
      rows: [{ ...preview.rows[0], selectedForImport: true }],
    }
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: selectedPreview })
    let resolveConfirmation
    importPreviewApi.confirm.mockReturnValue(new Promise((resolve) => { resolveConfirmation = resolve }))
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(selectedPreview))

    let first
    let second
    act(() => {
      first = result.current.confirm()
      second = result.current.confirm()
    })

    expect(importPreviewApi.confirm).toHaveBeenCalledOnce()
    expect(result.current.confirming).toBe(true)
    await act(async () => {
      resolveConfirmation({ status: 200, data: confirmed })
      await first
      await second
    })
    expect(result.current.confirming).toBe(false)
  })

  it('refetches authoritative duplicate warnings and permits a later explicit reselection', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    const selectedPreview = {
      ...preview,
      rows: [{ ...preview.rows[0], selectedForImport: true }],
    }
    const refreshedPreview = {
      ...preview,
      rows: [{
        ...preview.rows[0], selectedForImport: false, isPossibleDuplicate: true,
        warnings: ['possible_duplicate'],
      }],
    }
    importPreviewApi.getById
      .mockResolvedValueOnce({ status: 200, data: selectedPreview })
      .mockResolvedValueOnce({ status: 200, data: refreshedPreview })
    importPreviewApi.confirm
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: 'duplicate_review_required', message: 'private detail',
            rows: [{ rowId: 'row-1', codes: ['possible_duplicate', 'private_code'] }],
          },
        },
      })
      .mockResolvedValueOnce({ status: 200, data: confirmed })
    importPreviewApi.updateRow.mockResolvedValue({
      data: { ...refreshedPreview.rows[0], selectedForImport: true },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(selectedPreview))

    await act(() => result.current.confirm())

    expect(importPreviewApi.getById).toHaveBeenLastCalledWith(preview.batchId)
    expect(result.current.preview).toEqual(refreshedPreview)
    expect(result.current.selectedCount).toBe(0)
    expect(result.current.confirmationIssue).toEqual(expect.objectContaining({
      code: 'duplicate_review_required',
      rows: [{ rowId: 'row-1', codes: ['possible_duplicate'] }],
      requiresPreviewRefresh: false,
    }))
    expect(result.current.confirmationIssue.message).not.toContain('private detail')

    await act(() => result.current.updateRow('row-1', {
      editableExpenseDescription: 'Coffee', category: 'food', selectedForImport: true,
    }))
    expect(result.current.selectedCount).toBe(1)
    expect(result.current.confirmationIssue.rows).toEqual([])

    await act(() => result.current.confirm())
    expect(result.current.confirmation).toEqual(confirmed)
    expect(importPreviewApi.confirm).toHaveBeenCalledTimes(2)
  })

  it('blocks stale confirmation state when duplicate-review refetch fails', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById
      .mockResolvedValueOnce({ status: 200, data: preview })
      .mockRejectedValueOnce(new Error('offline'))
    importPreviewApi.confirm.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: 'duplicate_review_required',
          rows: [{ rowId: 'row-1', codes: ['possible_duplicate'] }],
        },
      },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.confirm())

    expect(result.current.preview).toEqual(preview)
    expect(result.current.confirmationIssue.requiresPreviewRefresh).toBe(true)
    expect(result.current.confirmationIssue.message).toContain('Refresh this page')
  })

  it.each([
    [400, 'no_rows_selected'],
    [409, 'confirmation_conflict'],
    [500, 'confirmation_failed'],
  ])('keeps the preview usable after HTTP %s %s', async (status, code) => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    importPreviewApi.confirm.mockRejectedValue({
      response: { status, data: { code, message: 'private detail', rows: [] } },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.confirm())

    expect(result.current.preview).toEqual(preview)
    expect(result.current.confirmation).toBeNull()
    expect(result.current.confirmationIssue.code).toBe(code)
    expect(result.current.confirmationIssue.message).not.toContain('private detail')
  })

  it('releases the in-flight guard so a deliberate retry can return stable success', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    importPreviewApi.confirm
      .mockRejectedValueOnce({
        response: { status: 500, data: { code: 'confirmation_failed', rows: [] } },
      })
      .mockResolvedValueOnce({ status: 200, data: confirmed })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.confirm())
    expect(result.current.confirmationIssue.code).toBe('confirmation_failed')

    await act(() => result.current.confirm())
    expect(result.current.confirmation).toEqual(confirmed)
    expect(importPreviewApi.confirm).toHaveBeenCalledTimes(2)
  })

  it('keeps the preview and maps only known validation codes to matching rows', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    importPreviewApi.confirm.mockRejectedValue({
      response: {
        status: 422,
        data: {
          code: 'confirmation_validation_failed', message: 'private detail',
          rows: [{ rowId: 'row-1', codes: ['description_required', 'private_code'] }],
        },
      },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.confirm())

    expect(result.current.preview).toEqual(preview)
    expect(result.current.confirmationIssue.rows).toEqual([
      { rowId: 'row-1', codes: ['description_required'] },
    ])
  })

  it.each([
    [404, undefined, 'preview_unavailable'],
    [410, { code: 'preview_expired', rows: [] }, 'preview_expired'],
  ])('retires the preview and deep link after HTTP %s', async (status, data, expectedCode) => {
    window.history.replaceState({}, '', `/transactions?keep=yes&importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    importPreviewApi.confirm.mockRejectedValue({ response: { status, data } })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.confirm())

    expect(result.current.preview).toBeNull()
    expect(result.current.confirmationIssue.code).toBe(expectedCode)
    expect(window.location.search).toBe('?keep=yes')
  })

  it('cleans an unavailable resumed deep link without inventing ownership details', async () => {
    window.history.replaceState({}, '', `/transactions?keep=yes&importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockRejectedValue({ response: { status: 404 } })
    const { result } = renderHook(() => useImportPreview())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('This import preview is unavailable. Choose the bank and upload the statement again.')
    expect(window.location.search).toBe('?keep=yes')
  })
})
