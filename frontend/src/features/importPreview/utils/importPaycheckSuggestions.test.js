import { describe, expect, it } from 'vitest'
import { makePaycheck } from '../../paychecks/test/paycheckFixtures'
import {
  buildLinkIntent,
  importPaycheckSuggestions,
  isSuggestionCandidateRow,
  resolveLinkTarget,
} from './importPaycheckSuggestions'

// makePaycheck: fixed 2500.00, current slot 2026-08-10 (window 08-09..08-11), previous 07-10
// (window 07-09..07-11), all three evidence deposits already linked.
const deposit = (overrides = {}) => ({
  rowId: 'd1',
  sourceRowOrdinal: 1,
  postedDate: '2026-08-10',
  amount: '2500.00',
  direction: 'credit',
  sourceDescription: ' ACME PAYROLL ',
  classification: 'non_expense',
  isEligible: false,
  isInflowEligible: true,
  isPossibleInflowDuplicate: false,
  duplicateInflowIds: [],
  selectedForInflow: false,
  ...overrides,
})
const saved = (id, overrides = {}) => ({ id, date: '2026-08-10', amount: 2500, description: 'ACME PAYROLL', ...overrides })
const suggest = (rows, paychecks = [makePaycheck()], inflows = []) => importPaycheckSuggestions({ rows, paychecks, inflows })

describe('importPaycheckSuggestions', () => {
  it('suggests an unselected deposit row for the open slot it matches', () => {
    const [result] = suggest([deposit()])
    expect(result.row.rowId).toBe('d1')
    expect(result.profile.displayName).toBe('Acme Payroll')
    expect(result.slot.anchor).toBe('2026-08-10')
  })

  it('keeps the window inclusive and rejects dates outside it', () => {
    expect(suggest([deposit({ postedDate: '2026-08-09' })])).toHaveLength(1)
    expect(suggest([deposit({ postedDate: '2026-08-11' })])).toHaveLength(1)
    expect(suggest([deposit({ postedDate: '2026-08-12' })])).toHaveLength(0)
    expect(suggest([deposit({ postedDate: '2026-08-08' })])).toHaveLength(0)
  })

  it('matches a fixed amount to the cent and a range inclusively', () => {
    expect(suggest([deposit({ amount: '2500.01' })])).toHaveLength(0)
    const range = makePaycheck({ amount: { mode: 'range', fixedAmount: null, minimumAmount: 2400, maximumAmount: 2600 } })
    expect(suggest([deposit({ amount: '2400.00' })], [range])).toHaveLength(1)
    expect(suggest([deposit({ amount: '2600.00' })], [range])).toHaveLength(1)
    expect(suggest([deposit({ amount: '2600.01' })], [range])).toHaveLength(0)
  })

  it('does not guess when two review deposits fit the same slot', () => {
    expect(suggest([deposit(), deposit({ rowId: 'd2', sourceRowOrdinal: 2 })])).toHaveLength(0)
  })

  it('counts an existing unlinked saved deposit toward ambiguity', () => {
    expect(suggest([deposit()], [makePaycheck()], [saved(900)])).toHaveLength(0)
    // A saved deposit outside the window does not matter.
    expect(suggest([deposit()], [makePaycheck()], [saved(901, { date: '2026-08-20' })])).toHaveLength(1)
  })

  it('ignores paused or ended schedules', () => {
    expect(suggest([deposit()], [makePaycheck({ lifecycle: 'paused' })])).toHaveLength(0)
    expect(suggest([deposit()], [makePaycheck({ lifecycle: 'ended' })])).toHaveLength(0)
  })

  it('only considers inflow-eligible credit rows, with or without selection', () => {
    expect(suggest([deposit({ direction: 'debit' })])).toHaveLength(0)
    expect(suggest([deposit({ isInflowEligible: false })])).toHaveLength(0)
    expect(suggest([deposit({ selectedForInflow: true })])).toHaveLength(1)
  })

  it('gives nothing to possible-duplicate rows', () => {
    expect(isSuggestionCandidateRow(deposit({ isPossibleInflowDuplicate: true }))).toBe(false)
    expect(isSuggestionCandidateRow(deposit({ duplicateInflowIds: [7] }))).toBe(false)
    expect(suggest([deposit({ isPossibleInflowDuplicate: true })])).toHaveLength(0)
  })

  it('does not match unsafe or inexact amounts or an invalid date', () => {
    expect(suggest([deposit({ amount: 2 ** 47 })])).toHaveLength(0)
    expect(suggest([deposit({ amount: '2500.001' })])).toHaveLength(0)
    expect(suggest([deposit({ amount: null })])).toHaveLength(0)
    expect(suggest([deposit({ postedDate: '2026-02-31' })])).toHaveLength(0)
  })

  it('orders suggestions by statement row and returns nothing for missing inputs', () => {
    const two = [
      deposit({ rowId: 'later', sourceRowOrdinal: 9, postedDate: '2026-07-10' }),
      deposit({ rowId: 'earlier', sourceRowOrdinal: 2 }),
    ]
    expect(suggest(two).map((entry) => entry.row.rowId)).toEqual(['earlier', 'later'])
    expect(importPaycheckSuggestions({ rows: two })).toEqual([])
  })
})

describe('resolveLinkTarget', () => {
  const [suggestion] = suggest([deposit()])
  const intent = buildLinkIntent(deposit(), suggestion)
  const resolve = (overrides = {}) => resolveLinkTarget({
    intent,
    snapshotIds: new Set(['1', '2']),
    inflows: [saved(1, { date: '2026-06-01' }), saved(900)],
    paychecks: [makePaycheck()],
    ...overrides,
  })

  it('captures the trimmed description, exact cents, profile and slot', () => {
    expect(intent).toMatchObject({ rowId: 'd1', date: '2026-08-10', cents: 250000n, description: 'ACME PAYROLL', slotAnchor: '2026-08-10' })
  })

  it('resolves the one new deposit that matches and is still suggested for the same slot', () => {
    expect(resolve()).toEqual({ ok: true, inflowId: 900, profileId: makePaycheck().id, slotAnchor: '2026-08-10' })
  })

  it('never picks a deposit that existed before saving, even when identical', () => {
    expect(resolve({ snapshotIds: new Set(['900']), inflows: [saved(900)] }).ok).toBe(false)
  })

  it('does not link when an older identical deposit makes the target ambiguous', () => {
    expect(resolve({ inflows: [saved(900), saved(901)] }).ok).toBe(false)
  })

  it('does not link when the slot moved or the schedule is gone or paused', () => {
    const moved = makePaycheck({ receiptSlots: [{ relation: 'current', anchor: '2026-09-10', earliestExpectedDate: '2026-09-09', latestExpectedDate: '2026-09-11' }] })
    expect(resolve({ paychecks: [moved] }).ok).toBe(false)
    expect(resolve({ paychecks: [] }).ok).toBe(false)
    expect(resolve({ paychecks: [makePaycheck({ lifecycle: 'paused' })] }).ok).toBe(false)
  })

  it('does not link when the saved deposit differs in date, cents or description', () => {
    expect(resolve({ inflows: [saved(900, { date: '2026-08-11' })] }).ok).toBe(false)
    expect(resolve({ inflows: [saved(900, { amount: 2500.5 })] }).ok).toBe(false)
    expect(resolve({ inflows: [saved(900, { description: 'OTHER' })] }).ok).toBe(false)
  })

  it('does not link when a different schedule is now the only match', () => {
    const other = makePaycheck({ id: '11111111-2222-3333-4444-555555555555' })
    expect(resolve({ paychecks: [other] }).ok).toBe(false)
  })

  it('fails closed without a snapshot or valid reads', () => {
    expect(resolve({ snapshotIds: null }).ok).toBe(false)
    expect(resolve({ inflows: null }).ok).toBe(false)
  })

  it('skips deposits already used by an earlier link in the same run', () => {
    expect(resolve({ usedIds: new Set(['900']) }).ok).toBe(false)
  })
})
