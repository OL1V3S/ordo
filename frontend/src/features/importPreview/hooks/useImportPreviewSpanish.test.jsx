import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importPreviewApi } from '../api/importPreviewApi'
import { useImportPreview } from './useImportPreview'
import i18n from '../../../shared/localization/i18n'

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

const duplicateConflict = {
  response: {
    status: 409,
    data: {
      code: 'duplicate_review_required',
      message: 'private detail',
      rows: [{ rowId: 'row-1', codes: ['possible_duplicate'] }],
    },
  },
}

describe('useImportPreview in Spanish', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/transactions')
    importPreviewApi.getOpen.mockResolvedValue({ status: 204, data: null })
    await i18n.changeLanguage('es')
  })
  afterEach(async () => { await i18n.changeLanguage('en') })

  it('maps safe upload error codes to Spanish and hides server text', async () => {
    importPreviewApi.upload.mockRejectedValue({
      response: { data: { code: 'encrypted_pdf', message: 'internal detail' } },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.selectSource('sunflower_pdf'))
    await act(() => result.current.upload(new File(['pdf'], 'statement.pdf')))

    expect(result.current.error).toBe('No se admiten PDF cifrados ni protegidos con contraseña.')
    expect(result.current.error).not.toContain('internal detail')
  })

  it('falls back to a readable Spanish message for unknown upload codes', async () => {
    importPreviewApi.upload.mockRejectedValue({
      response: { data: { code: 'brand_new_code', message: 'internal detail' } },
    })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.selectSource('sunflower_pdf'))
    await act(() => result.current.upload(new File(['pdf'], 'statement.pdf')))

    expect(result.current.error).toBe('No se pudo procesar el estado de cuenta de forma segura.')
  })

  it('uses Spanish load and row-update fallbacks', async () => {
    importPreviewApi.getOpen.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.selectSource('sunflower_pdf'))
    expect(result.current.error).toBe('No se pudo cargar la vista previa de importación guardada.')

    importPreviewApi.getOpen.mockResolvedValueOnce({ status: 200, data: preview })
    await act(() => result.current.selectSource('sunflower_pdf'))
    importPreviewApi.updateRow.mockRejectedValue({ response: { data: { code: 'row_not_selectable' } } })
    await act(() => result.current.updateRow('row-1', { selectedForImport: true }))
    expect(result.current.error).toBe('Esa fila no se puede seleccionar para importar.')

    importPreviewApi.updateRow.mockRejectedValue(new Error('offline'))
    await act(() => result.current.updateRow('row-1', { selectedForImport: true }))
    expect(result.current.error).toBe('No se pudo actualizar la fila de la vista previa.')
  })

  it('keeps the duplicate-review code and rows while showing the Spanish message', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    importPreviewApi.confirm.mockRejectedValue(duplicateConflict)
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.confirm())

    expect(result.current.confirmationIssue).toEqual({
      code: 'duplicate_review_required',
      message: 'Se encontraron posibles duplicados nuevos. Revisa las filas afectadas y selecciona de forma explícita cualquier fila que aún quieras importar.',
      rows: [{ rowId: 'row-1', codes: ['possible_duplicate'] }],
      requiresPreviewRefresh: false,
    })
    expect(result.current.confirmationIssue.message).not.toContain('private detail')
    expect(result.current.selectedCount).toBe(0)
  })

  it('requires a refresh in Spanish when the duplicate-review refetch fails', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById
      .mockResolvedValueOnce({ status: 200, data: preview })
      .mockRejectedValueOnce(new Error('offline'))
    importPreviewApi.confirm.mockRejectedValue(duplicateConflict)
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    await act(() => result.current.confirm())

    expect(result.current.confirmationIssue.requiresPreviewRefresh).toBe(true)
    expect(result.current.confirmationIssue.message).toBe(
      'Se guardaron las nuevas advertencias de duplicados, pero no se pudo cargar la vista previa más reciente. Actualiza esta página antes de confirmar.',
    )
  })

  it('localizes confirmation outcomes without changing their codes', async () => {
    window.history.replaceState({}, '', `/transactions?importBatch=${preview.batchId}`)
    importPreviewApi.getById.mockResolvedValue({ status: 200, data: preview })
    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.preview).toEqual(preview))

    importPreviewApi.confirm.mockRejectedValueOnce({ response: { status: 409, data: { code: 'confirmation_conflict' } } })
    await act(() => result.current.confirm())
    expect(result.current.confirmationIssue.code).toBe('confirmation_conflict')
    expect(result.current.confirmationIssue.message).toBe(
      'No se pudo confirmar el estado de cuenta porque cambió el estado de su importación. Revisa la vista previa e inténtalo de nuevo.',
    )

    importPreviewApi.confirm.mockRejectedValueOnce({ response: { status: 500, data: { code: 'something_else' } } })
    await act(() => result.current.confirm())
    expect(result.current.confirmationIssue.code).toBe('confirmation_failed')
    expect(result.current.confirmationIssue.message).toBe(
      'No se pudo confirmar el estado de cuenta de forma segura. No se informa que se haya importado nada; puedes intentarlo de nuevo.',
    )

    importPreviewApi.confirm.mockRejectedValueOnce({ response: { status: 404 } })
    await act(() => result.current.confirm())
    expect(result.current.confirmationIssue.code).toBe('preview_unavailable')
    expect(result.current.confirmationIssue.message).toBe(
      'Esta vista previa de importación no está disponible. Elige el banco y carga el estado de cuenta de nuevo.',
    )
    expect(result.current.preview).toBeNull()
  })

  it('shows the Spanish message when a resumed deep link is gone', async () => {
    window.history.replaceState({}, '', '/transactions?importBatch=11111111-1111-1111-1111-111111111111&keep=yes')
    importPreviewApi.getById.mockRejectedValue({ response: { status: 404 } })

    const { result } = renderHook(() => useImportPreview())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe(
      'Esta vista previa de importación no está disponible. Elige el banco y carga el estado de cuenta de nuevo.',
    )
    expect(window.location.search).toBe('?keep=yes')
  })
})
