import { beforeEach, describe, expect, it, vi } from 'vitest'
import client from '../../../shared/api/client'
import { importPreviewApi } from './importPreviewApi'

vi.mock('../../../shared/api/client', () => ({ default: {
  get: vi.fn(), post: vi.fn(), patch: vi.fn(),
} }))

describe('importPreviewApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uploads the selected file as the authenticated multipart field', () => {
    const file = new File(['pdf'], 'private-name.pdf', { type: 'application/pdf' })
    const signal = new AbortController().signal

    importPreviewApi.upload('sunflower_pdf', file, signal)

    expect(client.post).toHaveBeenCalledWith('/api/import-previews', expect.any(FormData), { signal })
    const form = client.post.mock.calls[0][1]
    expect(form.get('sourceType')).toBe('sunflower_pdf')
    expect(form.get('file')).toBe(file)
  })

  it('uses server-authoritative resume and row mutation routes', () => {
    const signal = new AbortController().signal
    importPreviewApi.getOpen('sunflower_pdf', signal)
    importPreviewApi.getById('batch-id', signal)
    importPreviewApi.updateRow('batch-id', 'row-id', { selectedForImport: true })

    expect(client.get).toHaveBeenCalledWith('/api/import-previews/open', {
      params: { sourceType: 'sunflower_pdf' }, signal,
    })
    expect(client.get).toHaveBeenCalledWith('/api/import-previews/batch-id', { signal })
    expect(client.patch).toHaveBeenCalledWith('/api/import-previews/batch-id/rows/row-id', {
      selectedForImport: true,
    })
  })

  it('confirms the server-owned batch without a request body', () => {
    importPreviewApi.confirm('batch-id')

    expect(client.post).toHaveBeenCalledWith('/api/import-previews/batch-id/confirm')
  })
})
