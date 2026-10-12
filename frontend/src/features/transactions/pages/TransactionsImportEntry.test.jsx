import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionsPage from './TransactionsPage'
import i18n from '../../../shared/localization/i18n'
import { clearSession, establishSession } from '../../../shared/auth/session'
import { markCaptureRecovery } from '../../home/recovery/captureRecovery'
import { useInflows } from '../../inflows/hooks/useInflows'
import { useExpenses } from '../../expenses/hooks/useExpenses'
import { useImportPreview } from '../../importPreview/hooks/useImportPreview'
import { useActivityTimeline } from '../../activity/hooks/useActivityTimeline'

vi.mock('../../inflows/hooks/useInflows', () => ({ useInflows: vi.fn() }))
vi.mock('../../expenses/hooks/useExpenses', () => ({ useExpenses: vi.fn() }))
vi.mock('../../importPreview/hooks/useImportPreview', () => ({ useImportPreview: vi.fn() }))
vi.mock('../../activity/hooks/useActivityTimeline', () => ({ useActivityTimeline: vi.fn() }))

const refresh = () => vi.fn().mockResolvedValue({ stale: false })
const inflowsHook = { inflows: [], loading: false, error: null, refresh: refresh(), createInflow: vi.fn(), updateInflow: vi.fn(), deleteInflow: vi.fn() }
const expensesHook = { expenses: [], loading: false, error: null, refresh: refresh(), addExpense: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn() }
const importHook = {
  preview: null, sourceType: '', loading: false, processing: false, error: '', confirming: false,
  confirmation: null, confirmedRows: null, confirmationIssue: null, selectedCount: 0,
  selectSource: vi.fn(), upload: vi.fn(), cancel: vi.fn(), updateRow: vi.fn(), confirm: vi.fn(),
  clearForReupload: vi.fn(), dismissConfirmation: vi.fn(),
}
const timeline = { items: [], hasMore: false, loading: false, error: false, refreshFailed: false, malformed: false, loadingMore: false, loadMoreFailed: false, loadMore: vi.fn(), refresh: refresh() }
const savedExpense = { id: 'x1', description: 'Coffee', amount: '8.50', date: '2026-08-12', category: 'food' }

describe('statement import entry point and results hand-off', () => {
  beforeEach(() => {
    useInflows.mockReturnValue({ ...inflowsHook })
    useExpenses.mockReturnValue({ ...expensesHook })
    useImportPreview.mockReturnValue({ ...importHook })
    useActivityTimeline.mockReturnValue({ ...timeline })
  })
  afterEach(async () => { await i18n.changeLanguage('en') })

  it('keeps the header action named Import statement with a described hint', () => {
    render(<TransactionsPage />)
    const button = screen.getByRole('button', { name: 'Import statement' })
    expect(button).not.toHaveClass('button-ghost')
    expect(button).toHaveAccessibleDescription('Review and save many transactions from a bank statement PDF.')
  })

  it('offers a PDF import prompt on an empty Activity page and opens the import task from it', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)
    expect(screen.getByText('Have a bank statement? Import a PDF to review and save many transactions at once.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Import a PDF' }))

    expect(screen.getByRole('button', { name: 'Choose PDF' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Import a PDF' })).not.toBeInTheDocument()
    await waitFor(() => expect(document.getElementById('statement-import-task')).toHaveFocus())
  })

  it.each([
    ['expenses exist', () => useExpenses.mockReturnValue({ ...expensesHook, expenses: [savedExpense] })],
    ['cash in exists', () => useInflows.mockReturnValue({ ...inflowsHook, inflows: [{ id: 'c1', description: 'Gift', amount: '5.00', date: '2026-08-12' }] })],
    ['expenses are loading', () => useExpenses.mockReturnValue({ ...expensesHook, loading: true })],
    ['cash in is loading', () => useInflows.mockReturnValue({ ...inflowsHook, loading: true })],
    ['expenses failed to load', () => useExpenses.mockReturnValue({ ...expensesHook, error: 'x' })],
    ['cash in failed to load', () => useInflows.mockReturnValue({ ...inflowsHook, error: 'x' })],
  ])('hides the prompt when %s', (_name, arrange) => {
    arrange()
    render(<TransactionsPage />)
    expect(screen.queryByText(/Have a bank statement\?/)).not.toBeInTheDocument()
  })

  it('shows the prompt in Spanish', async () => {
    await i18n.changeLanguage('es')
    render(<TransactionsPage />)
    expect(screen.getByText('¿Tienes un estado de cuenta bancario? Importa un PDF para revisar y guardar muchas transacciones a la vez.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importar un PDF' })).toBeInTheDocument()
  })

  describe('after a confirmed import', () => {
    const confirmation = { batchId: 'b', status: 'confirmed', confirmedAt: '2026-08-25T21:00:00Z', importedExpenseCount: 1, importedInflowCount: 0 }
    const confirmedRows = { expenses: [{ rowId: 'r', description: 'Coffee', category: 'food', postedDate: '2026-08-12', amount: '8.50' }], deposits: [] }

    it('closes the import, dismisses the confirmation and focuses the timeline heading', async () => {
      const user = userEvent.setup()
      const dismissConfirmation = vi.fn()
      useImportPreview.mockReturnValue({ ...importHook, confirmation, confirmedRows, dismissConfirmation })
      render(<TransactionsPage />)
      expect(within(screen.getByRole('region', { name: 'Rows saved from this review' })).getByText('Coffee')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'View in Transactions' }))

      expect(dismissConfirmation).toHaveBeenCalledOnce()
      await waitFor(() => expect(document.getElementById('activity-timeline-heading')).toHaveFocus())
    })

    it('falls back to the page heading when the timeline is not shown', async () => {
      const user = userEvent.setup()
      sessionStorage.clear(); establishSession('token', 'owner@example.test'); markCaptureRecovery('expense')
      useImportPreview.mockReturnValue({ ...importHook, confirmation, confirmedRows, dismissConfirmation: vi.fn() })
      render(<TransactionsPage />)
      expect(document.getElementById('activity-timeline-heading')).toBeNull()

      await user.click(screen.getByRole('button', { name: 'View in Transactions' }))

      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Transactions' })).toHaveFocus())
      clearSession(); sessionStorage.clear()
    })

    it('returns focus to the Import statement button on Done', async () => {
      const user = userEvent.setup()
      const dismissConfirmation = vi.fn()
      useImportPreview.mockReturnValue({ ...importHook, confirmation, confirmedRows, dismissConfirmation })
      render(<TransactionsPage />)

      await user.click(screen.getByRole('button', { name: 'Done' }))

      expect(dismissConfirmation).toHaveBeenCalledOnce()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Import statement' })).toHaveFocus())
    })
  })
})
