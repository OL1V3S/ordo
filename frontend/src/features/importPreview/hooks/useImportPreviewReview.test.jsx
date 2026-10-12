import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importPreviewApi } from '../api/importPreviewApi'
import { useImportPreview } from './useImportPreview'
import '../../../shared/localization/i18n'

vi.mock('../api/importPreviewApi', () => ({ importPreviewApi: {
  getOpen: vi.fn(), getById: vi.fn(), upload: vi.fn(), updateRow: vi.fn(), confirm: vi.fn(),
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
