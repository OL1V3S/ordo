import { describe, expect, it } from 'vitest'
import {
  bulkClearTargets,
  bulkSelectableExpenses,
  filterCounts,
  rowMatchesFilter,
  savedRowsMatchConfirmation,
  selectedTotals,
  snapshotSavedRows,
  summarize,
  totalsFromSavedRows,
} from './importReview'

const expense = {
  rowId: 'e1',
  postedDate: '2026-08-12',
  amount: '8.50',
  direction: 'debit',
  sourceDescription: 'CAFE',
  classification: 'expense_candidate',
  isEligible: true,
  isInflowEligible: false,
  errors: [],
  warnings: [],
  isPossibleDuplicate: false,
  isPossibleInflowDuplicate: false,
  duplicateExpenseIds: [],
  editableExpenseDescription: 'Coffee',
  category: 'food',
  selectedForImport: false,
  selectedForInflow: false,
}
const deposit = {
  ...expense,
  rowId: 'd1',
  amount: '100.00',
  direction: 'credit',
  sourceDescription: '  PAY DEPOSIT  ',
  classification: 'non_expense',
  isEligible: false,
  isInflowEligible: true,
  editableExpenseDescription: null,
  category: null,
}
const duplicate = { ...expense, rowId: 'dup', isPossibleDuplicate: true, warnings: ['possible_duplicate'] }
const matchedIds = { ...expense, rowId: 'ids', duplicateExpenseIds: ['x'] }
const needsReview = { ...expense, rowId: 'nr', classification: 'needs_review', isEligible: false, errors: ['invalid_transaction_amount'] }
const invalid = { ...expense, rowId: 'inv', classification: 'invalid', isEligible: false, isInflowEligible: false }
const selectedExpense = { ...expense, rowId: 'se', selectedForImport: true }
const selectedDeposit = { ...deposit, rowId: 'sd', selectedForInflow: true }
const all = [expense, deposit, duplicate, matchedIds, needsReview, invalid, selectedExpense, selectedDeposit]

describe('importReview summary and filters', () => {
  it('counts the whole statement', () => {
    expect(summarize(all)).toEqual({
      total: 8,
      expensesSelected: 1,
      depositsSelected: 1,
      possibleDuplicates: 1,
      needsReview: 2,
      cannotBeSelected: 2,
    })
  })

  it('does not count a selected flag on a row that is not eligible for it', () => {
    const summary = summarize([{ ...deposit, selectedForImport: true }, { ...expense, selectedForInflow: true }])
    expect(summary.expensesSelected).toBe(0)
    expect(summary.depositsSelected).toBe(0)
  })

  it('applies every filter predicate', () => {
    const ids = (filter, codes = {}) => all.filter((row) => rowMatchesFilter(row, filter, codes[row.rowId] ?? [])).map((row) => row.rowId)
    expect(ids('all')).toHaveLength(8)
    expect(ids('attention')).toEqual(['nr', 'inv'])
    expect(ids('attention', { e1: ['possible_duplicate'] })).toEqual(['e1', 'nr', 'inv'])
    expect(ids('duplicates')).toEqual(['dup'])
    expect(ids('deposits')).toEqual(['d1', 'sd'])
    expect(ids('selected')).toEqual(['se', 'sd'])
  })

  it('requires a credit for the deposits filter and flags any row error as needing attention', () => {
    expect(rowMatchesFilter({ ...deposit, direction: 'debit' }, 'deposits')).toBe(false)
    expect(rowMatchesFilter({ ...expense, errors: ['x'] }, 'attention')).toBe(true)
  })

  it('reports per-filter counts', () => {
    expect(filterCounts(all)).toEqual({ all: 8, attention: 2, duplicates: 1, deposits: 2, selected: 2 })
  })
})

describe('importReview bulk targets', () => {
  it('selects only unselected clean expense candidates', () => {
    expect(bulkSelectableExpenses(all).map((row) => row.rowId)).toEqual(['e1'])
  })

  it('excludes duplicates, deposits, needs-review, invalid and already-selected rows', () => {
    expect(bulkSelectableExpenses([duplicate, matchedIds, deposit, needsReview, invalid, selectedExpense])).toEqual([])
    expect(bulkSelectableExpenses([{ ...expense, duplicateExpenseIds: undefined }])).toHaveLength(1)
  })

  it('excludes possible inflow duplicates', () => {
    expect(bulkSelectableExpenses([{ ...expense, isPossibleInflowDuplicate: true }])).toEqual([])
  })

  it('clears every selected expense and deposit', () => {
    expect(bulkClearTargets(all).map((row) => row.rowId)).toEqual(['se', 'sd'])
  })
})

describe('importReview totals', () => {
  it('sums exact cents separately for each kind', () => {
    const rows = [
      { ...selectedExpense, amount: '0.1' },
      { ...selectedExpense, rowId: 'se2', amount: 0.2 },
      selectedDeposit,
    ]
    expect(selectedTotals(rows)).toEqual({ expenseCount: 2, expenseCents: 30n, depositCount: 1, depositCents: 10000n })
  })

  it('keeps very large totals exact', () => {
    const rows = [
      { ...selectedExpense, amount: '9007199254740993.01' },
      { ...selectedExpense, rowId: 'se2', amount: '0.99' },
    ]
    expect(selectedTotals(rows).expenseCents).toBe(900719925474099400n)
  })

  it('reports an unparseable amount as unavailable for that kind only', () => {
    const totals = selectedTotals([{ ...selectedExpense, amount: '1.005' }, selectedDeposit])
    expect(totals.expenseCents).toBeNull()
    expect(totals.depositCents).toBe(10000n)
    expect(selectedTotals([{ ...selectedExpense, amount: null }]).expenseCents).toBeNull()
    expect(selectedTotals([]).expenseCents).toBe(0n)
  })
})

describe('importReview saved rows', () => {
  const preview = { rows: all }

  it('snapshots the selected rows from server values', () => {
    expect(snapshotSavedRows(preview)).toEqual({
      expenses: [{ rowId: 'se', description: 'Coffee', category: 'food', postedDate: '2026-08-12', amount: '8.50' }],
      deposits: [{ rowId: 'sd', description: 'PAY DEPOSIT', postedDate: '2026-08-12', amount: '100.00' }],
    })
  })

  it('totals the snapshot and checks it against the confirmation counts', () => {
    const saved = snapshotSavedRows(preview)
    expect(totalsFromSavedRows(saved)).toEqual({ expenseCents: 850n, depositCents: 10000n })
    expect(savedRowsMatchConfirmation(saved, { importedExpenseCount: 1, importedInflowCount: 1 })).toBe(true)
    expect(savedRowsMatchConfirmation(saved, { importedExpenseCount: 2, importedInflowCount: 1 })).toBe(false)
    expect(savedRowsMatchConfirmation(null, { importedExpenseCount: 0, importedInflowCount: 0 })).toBe(false)
  })
})
