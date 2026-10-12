import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImportPreviewPanel from './ImportPreviewPanel'
import '../../../shared/localization/i18n'

// The sticky confirm bar overlays the end of .import-results, so every focusable control there
// (not only the row controls) needs a scroll-margin-bottom at least as tall as the bar (WCAG 2.4.11).
const css = readFileSync(resolve('src/styles/import-preview.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const clearanceSelectors = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, , body]) => /scroll-margin-bottom:\s*calc\(var\(--import-confirm-bar-height/.test(body))
  .map(([, selector]) => selector.trim())

const row = {
  rowId: 'e1',
  sourceRowOrdinal: 1,
  postedDate: '2026-08-12',
  amount: '8.50',
  direction: 'debit',
  sourceDescription: 'CAFE ONE',
  sourceSection: 'electronic_transactions',
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
  selectedForImport: true,
  selectedForInflow: false,
}

function renderPanel() {
  const state = {
    preview: { batchId: '11111111-1111-1111-1111-111111111111', sourceType: 'sunflower_pdf', expiresAt: '2026-08-26T12:00:00Z', rows: [row] },
    sourceType: 'sunflower_pdf',
    loading: false,
    processing: false,
    error: '',
    confirming: false,
    confirmation: null,
    confirmedRows: null,
    confirmationIssue: null,
    selectedCount: 1,
    selectSource: vi.fn(),
    upload: vi.fn(),
    cancel: vi.fn(),
    updateRow: vi.fn(),
    confirm: vi.fn(),
    clearForReupload: vi.fn(),
    dismissConfirmation: vi.fn(),
  }
  return render(<ImportPreviewPanel importState={state} />)
}

const hasClearance = (element) => clearanceSelectors.some((selector) => element.matches(selector))

describe('import results scroll clearance', () => {
  it('finds the clearance rule that uses the measured confirm bar height', () => {
    expect(clearanceSelectors.length).toBeGreaterThan(0)
  })

  it('covers the filter radios, bulk buttons, table region and row controls', () => {
    renderPanel()
    const table = screen.getByRole('region', { name: 'Statement import preview' })
    const controls = [
      ...screen.getAllByRole('radio'),
      screen.getByRole('button', { name: /^Select all eligible expenses/ }),
      screen.getByRole('button', { name: 'Clear selection' }),
      table,
      ...within(table).getAllByRole('checkbox'),
      ...within(table).getAllByRole('combobox'),
      ...within(table).getAllByRole('button'),
    ]
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(1)
    const missing = controls.filter((element) => !hasClearance(element))
    expect(missing.map((element) => element.outerHTML.slice(0, 80))).toEqual([])
  })

  it('does not apply to the confirm bar controls themselves', () => {
    renderPanel()
    const bar = screen.getByRole('group', { name: 'Confirm import' })
    const buttons = within(bar).getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
    buttons.forEach((button) => expect(hasClearance(button)).toBe(false))
  })
})
