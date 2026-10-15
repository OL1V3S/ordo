import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inflowsApi } from '../../inflows/api/inflowsApi'
import { paychecksApi } from '../../paychecks/api/paychecksApi'
import { makePaycheck } from '../../paychecks/test/paycheckFixtures'
import ImportPreviewPanel from './ImportPreviewPanel'
import i18n from '../../../shared/localization/i18n'

vi.mock('../../paychecks/api/paychecksApi', () => ({ paychecksApi: { getPaychecks: vi.fn(), recordReceipt: vi.fn() } }))
vi.mock('../../inflows/api/inflowsApi', () => ({ inflowsApi: { getAll: vi.fn() } }))

const BATCH = '11111111-1111-1111-1111-111111111111'
const profile = makePaycheck()
const deposit = {
  rowId: 'dep',
  sourceRowOrdinal: 1,
  postedDate: '2026-08-10',
  amount: '2500.00',
  direction: 'credit',
  sourceDescription: 'ACME PAYROLL',
  sourceSection: 'deposits',
  classification: 'non_expense',
  isEligible: false,
  isInflowEligible: true,
  errors: [],
  warnings: [],
  isPossibleDuplicate: false,
  isPossibleInflowDuplicate: false,
  editableExpenseDescription: null,
  category: null,
  selectedForImport: false,
  selectedForInflow: false,
}
const savedInflow = { id: 900, date: '2026-08-10', amount: 2500, description: 'ACME PAYROLL' }

let savedYet = false
const confirmedResponse = { batchId: BATCH, status: 'confirmed', confirmedAt: '2026-08-25T21:00:00Z', importedExpenseCount: 0, importedInflowCount: 1 }

// A small stateful stand-in for the import hook so selection changes and confirm behave like the
// real one, without any statement API.
function Harness({ rows = [deposit], confirmResult = confirmedResponse, onConfirm }) {
  const [preview, setPreview] = useState({ batchId: BATCH, sourceType: 'sunflower_pdf', expiresAt: '2026-08-26T12:00:00Z', rows })
  const [confirmation, setConfirmation] = useState(null)
  const [confirmedRows, setConfirmedRows] = useState(null)
  const selectedCount = preview?.rows.filter((row) => row.selectedForInflow).length ?? 0
  const state = {
    preview, sourceType: 'sunflower_pdf', loading: false, processing: false, error: '', confirming: false,
    confirmation, confirmedRows, confirmationIssue: null, selectedCount,
    selectSource: vi.fn(), upload: vi.fn(), cancel: vi.fn(), clearForReupload: vi.fn(), bulkSelection: vi.fn(),
    updateRow: vi.fn(async (rowId, payload) => {
      const updated = { ...preview.rows.find((row) => row.rowId === rowId), selectedForInflow: payload.selectedForInflow }
      setPreview((current) => ({ ...current, rows: current.rows.map((row) => row.rowId === rowId ? updated : row) }))
      return updated
    }),
    confirm: vi.fn(async () => {
      onConfirm?.()
      savedYet = true
      if (!confirmResult) return null
      setConfirmedRows({ expenses: [], deposits: preview.rows.filter((row) => row.selectedForInflow) })
      setConfirmation(confirmResult)
      setPreview(null)
      return confirmResult
    }),
    dismissConfirmation: () => setConfirmation(null),
  }
  return <ImportPreviewPanel importState={state} />
}

function mockReads({ before = [], after = [savedInflow], paychecks = [profile] } = {}) {
  inflowsApi.getAll.mockImplementation(async () => ({ data: savedYet ? after : before }))
  paychecksApi.getPaychecks.mockImplementation(async () => ({ data: { paychecks } }))
}

const toggle = () => screen.findByRole('checkbox', { name: /^Link to Acme Payroll when saved/ })
const saveButton = () => screen.getByRole('button', { name: /^Save / })

beforeEach(() => {
  vi.clearAllMocks()
  savedYet = false
  mockReads()
  paychecksApi.recordReceipt.mockResolvedValue({ data: {} })
})
afterEach(async () => { await i18n.changeLanguage('en') })

describe('paycheck suggestions on deposit rows', () => {
  it('offers an unticked link on a matching deposit and leaves the deposit unselected', async () => {
    render(<Harness />)
    expect(await toggle()).not.toBeChecked()
    expect(screen.getByText('May match Acme Payroll')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^Save deposit for / })).not.toBeChecked()
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()
  })

  it('shows nothing on a possible-duplicate deposit', async () => {
    render(<Harness rows={[{ ...deposit, isPossibleInflowDuplicate: true, warnings: ['possible_inflow_duplicate'] }]} />)
    expect(screen.getByRole('checkbox', { name: /^Save deposit for / })).toBeInTheDocument()
    expect(paychecksApi.getPaychecks).not.toHaveBeenCalled()
    expect(screen.queryByText(/May match/)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /when saved/ })).not.toBeInTheDocument()
  })

  it('shows no suggestion and no toggle when the deposits cannot be read', async () => {
    inflowsApi.getAll.mockRejectedValue(new Error('down'))
    render(<Harness />)
    await waitFor(() => expect(inflowsApi.getAll).toHaveBeenCalled())
    expect(screen.queryByText(/May match/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^Save deposit for / })).toBeInTheDocument()
  })

  it('does not suggest when an existing unlinked deposit also fits the slot', async () => {
    mockReads({ before: [{ ...savedInflow, id: 5 }] })
    render(<Harness />)
    await waitFor(() => expect(paychecksApi.getPaychecks).toHaveBeenCalled())
    expect(screen.queryByText(/May match/)).not.toBeInTheDocument()
  })
})

describe('saving and then linking', () => {
  it('selects the deposit on tick, links only after saving, and sends only the existing receipt fields', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()} />)
    await user.click(await toggle())
    expect(await toggle()).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^Save deposit for / })).toBeChecked()
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()

    await user.click(saveButton())

    expect(await screen.findByText('Linked to Acme Payroll.')).toBeInTheDocument()
    expect(paychecksApi.recordReceipt).toHaveBeenCalledTimes(1)
    expect(paychecksApi.recordReceipt).toHaveBeenCalledWith(profile.id, { slotAnchor: '2026-08-10', existingInflowId: 900 })
  })

  it('does not link a deposit saved without ticking the link', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await toggle()
    await user.click(screen.getByRole('checkbox', { name: /^Save deposit for / }))
    await user.click(saveButton())
    await screen.findByText('Import complete', { selector: 'h3' })
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()
    expect(screen.queryByText('Paycheck links')).not.toBeInTheDocument()
  })

  it('drops the link when the deposit is unselected', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(await toggle())
    await user.click(screen.getByRole('checkbox', { name: /^Save deposit for / }))
    expect(await toggle()).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: /^Save deposit for / }))
    expect(await toggle()).not.toBeChecked()
  })

  it('does not link when saving fails', async () => {
    const user = userEvent.setup()
    render(<Harness confirmResult={null} />)
    await user.click(await toggle())
    await user.click(saveButton())
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /when saved/ })).toBeInTheDocument())
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()
  })

  it('does not link when the save was already done elsewhere', async () => {
    const user = userEvent.setup()
    render(<Harness confirmResult={{ ...confirmedResponse, status: 'already_confirmed' }} />)
    await user.click(await toggle())
    await user.click(saveButton())
    expect(await screen.findByText(/^Not linked: the match changed/)).toBeInTheDocument()
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()
  })

  it('does not link when the saved counts do not match the selection', async () => {
    const user = userEvent.setup()
    render(<Harness confirmResult={{ ...confirmedResponse, importedInflowCount: 2 }} />)
    await user.click(await toggle())
    await user.click(saveButton())
    expect(await screen.findByText(/^Not linked: the match changed/)).toBeInTheDocument()
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()
  })

  it('does not link when the saved deposit cannot be identified', async () => {
    const user = userEvent.setup()
    mockReads({ after: [savedInflow, { ...savedInflow, id: 901 }] })
    render(<Harness />)
    await user.click(await toggle())
    await user.click(saveButton())
    expect(await screen.findByText(/^Not linked: the match changed/)).toBeInTheDocument()
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()
  })

  it('does not link when the reads after saving fail, and says the deposit is saved', async () => {
    const user = userEvent.setup()
    inflowsApi.getAll.mockImplementation(async () => {
      if (savedYet) throw new Error('down')
      return { data: [] }
    })
    render(<Harness />)
    await user.click(await toggle())
    await user.click(saveButton())
    expect(await screen.findByText(/^Not linked: we couldn’t link it\. The deposit is saved/)).toBeInTheDocument()
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled()
  })

  it('reports a rejected link as not linked while the deposit stays saved', async () => {
    const user = userEvent.setup()
    paychecksApi.recordReceipt.mockRejectedValue({ response: { status: 409, data: { code: 'receipt_slot_unavailable' } } })
    render(<Harness />)
    await user.click(await toggle())
    await user.click(saveButton())
    expect(await screen.findByText(/^Not linked: the match changed or couldn’t be confirmed\. The deposit is saved/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rows saved from this review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try linking again/ })).not.toBeInTheDocument()
  })

  it('treats a server error as uncertain, never retries on its own, and allows one manual retry', async () => {
    const user = userEvent.setup()
    paychecksApi.recordReceipt.mockRejectedValue({ response: { status: 503 } })
    render(<Harness />)
    await user.click(await toggle())
    await user.click(saveButton())
    expect(await screen.findByText(/^We couldn’t confirm whether this was linked/)).toBeInTheDocument()
    expect(paychecksApi.recordReceipt).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /^Try linking again/ }))
    await waitFor(() => expect(paychecksApi.recordReceipt).toHaveBeenCalledTimes(2))
    expect(paychecksApi.recordReceipt.mock.calls[1]).toEqual(paychecksApi.recordReceipt.mock.calls[0])
    expect(await screen.findByText(/^We couldn’t confirm whether this was linked/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try linking again/ })).not.toBeInTheDocument()
  })

  it('links several deposits one at a time using fresh schedules after each link', async () => {
    const user = userEvent.setup()
    const previous = { ...deposit, rowId: 'prev', sourceRowOrdinal: 2, postedDate: '2026-07-10', sourceDescription: 'ACME PAYROLL' }
    const second = { id: 901, date: '2026-07-10', amount: 2500, description: 'ACME PAYROLL' }
    let linked = 0
    paychecksApi.getPaychecks.mockImplementation(async () => ({ data: { paychecks: [linked === 0 ? profile
      : { ...profile, receiptSlots: profile.receiptSlots.filter((slot) => slot.relation === 'previous') }] } }))
    inflowsApi.getAll.mockImplementation(async () => ({ data: savedYet ? [savedInflow, second] : [] }))
    paychecksApi.recordReceipt.mockImplementation(async () => { linked += 1; return { data: {} } })
    render(<Harness rows={[deposit, previous]} confirmResult={{ ...confirmedResponse, importedInflowCount: 2 }} />)
    const boxes = await screen.findAllByRole('checkbox', { name: /^Link to Acme Payroll when saved/ })
    for (const box of boxes) await user.click(box)
    await user.click(saveButton())

    await waitFor(() => expect(screen.getAllByText('Linked to Acme Payroll.')).toHaveLength(2))
    expect(paychecksApi.recordReceipt.mock.calls.map(([, payload]) => payload)).toEqual([
      { slotAnchor: '2026-08-10', existingInflowId: 900 },
      { slotAnchor: '2026-07-10', existingInflowId: 901 },
    ])
  })
})

describe('paycheck suggestions in Spanish', () => {
  it('shows the Spanish match, link and result text', async () => {
    await i18n.changeLanguage('es')
    const user = userEvent.setup()
    render(<Harness />)
    const box = await screen.findByRole('checkbox', { name: /^Vincular a Acme Payroll al guardar/ })
    expect(screen.getByText('Podría coincidir con Acme Payroll')).toBeInTheDocument()
    await user.click(box)
    await user.click(screen.getByRole('button', { name: /^Guardar / }))
    expect(await screen.findByText('Vinculado a Acme Payroll.')).toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: 'Vínculos con pagos de nómina' }).parentElement).getAllByRole('listitem')).toHaveLength(1)
  })
})
