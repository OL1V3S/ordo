import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportPreviewPanel from './ImportPreviewPanel'
import i18n from '../../../shared/localization/i18n'

const expenseRow = {
  rowId: 'row-1',
  sourceRowOrdinal: 1,
  postedDate: '2026-08-12',
  amount: 8.5,
  direction: 'debit',
  sourceDescription: 'SYNTHETIC CAFE',
  sourceSection: 'electronic_transactions',
  classification: 'expense_candidate',
  isEligible: true,
  isInflowEligible: false,
  errors: [],
  warnings: [],
  isPossibleDuplicate: false,
  isPossibleInflowDuplicate: false,
  editableExpenseDescription: 'Coffee',
  category: 'food',
  selectedForImport: true,
  selectedForInflow: false,
}

const depositRow = {
  ...expenseRow,
  rowId: 'row-2',
  sourceRowOrdinal: 2,
  direction: 'credit',
  sourceDescription: 'SYNTHETIC DEPOSIT',
  sourceSection: 'deposits',
  classification: 'non_expense',
  isEligible: false,
  isInflowEligible: true,
  editableExpenseDescription: null,
  category: null,
  selectedForImport: false,
  selectedForInflow: false,
}

function previewWith(rows) {
  return {
    batchId: '11111111-1111-1111-1111-111111111111',
    sourceType: 'sunflower_pdf',
    expiresAt: '2026-08-26T12:00:00Z',
    rows,
  }
}

function importState(overrides = {}) {
  return {
    preview: previewWith([expenseRow]),
    sourceType: 'sunflower_pdf',
    loading: false,
    processing: false,
    error: '',
    confirming: false,
    confirmation: null,
    confirmationIssue: null,
    selectedCount: 1,
    selectSource: vi.fn(),
    upload: vi.fn(),
    cancel: vi.fn(),
    updateRow: vi.fn(),
    confirm: vi.fn(),
    clearForReupload: vi.fn(),
    ...overrides,
  }
}

const confirmed = {
  batchId: '11111111-1111-1111-1111-111111111111',
  status: 'confirmed',
  confirmedAt: '2026-08-25T21:00:00Z',
  importedExpenseCount: 1,
  importedInflowCount: 1,
}

describe('import preview in Spanish', () => {
  beforeEach(async () => { await i18n.changeLanguage('es') })
  afterEach(async () => { await i18n.changeLanguage('en') })

  it('renders the empty upload state with a bold prompt in Spanish', () => {
    render(<ImportPreviewPanel importState={importState({ preview: null, selectedCount: 0 })} />)

    expect(screen.getByText('Importación de estado de cuenta')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Importar estado de cuenta' })).toBeInTheDocument()
    expect(screen.getByText(/Elige tu banco y sube el PDF que descargaste de él \(hasta 10 MB\)/)).toBeInTheDocument()
    expect(screen.getByText(/Primero guarda los cambios de cada fila/)).toBeInTheDocument()
    expect(screen.getByLabelText('Banco')).toHaveValue('sunflower_pdf')
    expect(screen.getByRole('option', { name: 'Elige un banco' })).toBeInTheDocument()
    expect(screen.getByLabelText('PDF del estado de cuenta de Sunflower')).toBeInTheDocument()
    expect(screen.getByText('Suelta aquí un PDF de estado de cuenta').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: 'Elegir PDF' })).toBeEnabled()
  })

  it('shows the Spanish hint and processing states', () => {
    const { rerender } = render(<ImportPreviewPanel importState={importState({ preview: null, sourceType: '', selectedCount: 0 })} />)
    expect(screen.getByText('Elige un banco para subir un PDF.')).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState({ preview: null, processing: true, selectedCount: 0 })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Leyendo tu estado de cuenta…')
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState({ preview: null, loading: true, selectedCount: 0 })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Buscando una vista previa sin terminar…')
  })

  it('renders the review table, selection controls, and row fields in Spanish', () => {
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([expenseRow, depositRow]) })} />)

    expect(screen.getByText('Revisar y confirmar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Elegir otro estado de cuenta' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Revisar estado de cuenta' })).toBeInTheDocument()
    expect(screen.getByText(/^2 filas · disponible hasta /)).toBeInTheDocument()
    expect(screen.getByText('1 gasto y 0 depósitos').tagName).toBe('STRONG')
    expect(screen.getByText(/seleccionados para guardar\./)).toBeInTheDocument()
    expect(screen.getByText('Revisa las filas seleccionadas y luego guárdalas juntas.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar 1 gasto y 0 depósitos' })).toBeEnabled()

    const table = screen.getByRole('region', { name: 'Vista previa del estado de cuenta' })
    expect(within(table).getByText('Filas del estado de cuenta de Sunflower Bank', { selector: 'caption' })).toBeInTheDocument()
    for (const header of ['Fila', 'Estado', 'Selección', 'Detalles del gasto']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    const context = 'SYNTHETIC CAFE, 12 ago 2026, fila 1 del estado de cuenta'
    expect(within(table).getByRole('checkbox', { name: `Seleccionar para importar: ${context}` })).toBeChecked()
    expect(within(table).getByLabelText(`Descripción del gasto: ${context}`)).toHaveValue('Coffee')
    expect(within(table).getByLabelText(`Categoría: ${context}`)).toHaveValue('food')
    expect(within(table).getByRole('option', { name: 'Comida' })).toBeInTheDocument()
    expect(within(table).getByRole('option', { name: 'Sin categoría' })).toBeInTheDocument()
    expect(within(table).getByRole('option', { name: 'Otra' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: `Guardar fila: ${context}` })).toBeDisabled()
    expect(within(table).getByText('Gasto por revisar')).toBeInTheDocument()
    expect(within(table).getByText('Cargo')).toBeInTheDocument()
    expect(within(table).getByText('Transacciones electrónicas')).toBeInTheDocument()
    expect(within(table).getAllByText('Detalles del estado de cuenta').length).toBeGreaterThan(0)

    const deposit = 'SYNTHETIC DEPOSIT, 12 ago 2026, fila 2 del estado de cuenta'
    expect(within(table).getByRole('checkbox', { name: `Guardar depósito: ${deposit}` })).not.toBeChecked()
    expect(within(table).getByText('Depósito')).toBeInTheDocument()
    expect(within(table).getByText('Abono')).toBeInTheDocument()
    expect(within(table).getByText('Depósitos')).toBeInTheDocument()
    expect(within(table).getByText('No editable')).toBeInTheDocument()
    expect(within(table).getByText(/No se cuenta como ingreso ni como pago de nómina\./)).toBeInTheDocument()
  })

  it('formats the review row date like the saved list in Spanish, with unavailable fallbacks for a missing or invalid date', () => {
    const rows = [
      expenseRow,
      { ...expenseRow, rowId: 'row-x2', sourceRowOrdinal: 5, postedDate: null },
      { ...expenseRow, rowId: 'row-x3', sourceRowOrdinal: 6, postedDate: 'not-a-date' },
    ]
    render(<ImportPreviewPanel importState={importState({ preview: previewWith(rows), selectedCount: 3 })} />)
    const table = screen.getByRole('region', { name: 'Vista previa del estado de cuenta' })

    expect(within(table).getByText('12 ago 2026')).toBeVisible()
    expect(within(table).queryByText('2026-08-12')).not.toBeInTheDocument()
    expect(within(table).queryByText('not-a-date')).not.toBeInTheDocument()
    expect(within(table).getByRole('checkbox', { name: 'Seleccionar para importar: SYNTHETIC CAFE, 12 ago 2026, fila 1 del estado de cuenta' })).toBeInTheDocument()
    expect(within(table).getByRole('checkbox', { name: 'Seleccionar para importar: SYNTHETIC CAFE, fecha no disponible, fila 5 del estado de cuenta' })).toBeInTheDocument()
    expect(within(table).getByRole('checkbox', { name: 'Seleccionar para importar: SYNTHETIC CAFE, fecha no disponible, fila 6 del estado de cuenta' })).toBeInTheDocument()
    const dateFacts = [...table.querySelectorAll('.import-row-transaction__facts > div:first-child')].map((node) => node.textContent)
    expect(dateFacts.slice(0, 1)).toEqual(['Fecha12 ago 2026'])
    expect(dateFacts.slice(-2)).toEqual(['FechaNo disponible', 'FechaNo disponible'])
  })

  it('keeps the exact meaning of the duplicate warnings in Spanish', () => {
    const duplicate = { ...expenseRow, isPossibleDuplicate: true, warnings: ['possible_duplicate'], selectedForImport: false }
    const inflowDuplicate = { ...depositRow, isPossibleInflowDuplicate: true, warnings: ['possible_inflow_duplicate'] }
    render(<ImportPreviewPanel importState={importState({
      preview: previewWith([duplicate, inflowDuplicate]),
      selectedCount: 0,
    })} />)

    expect(screen.getByText('Posible duplicado: se parece a uno que ya guardaste. Revísalo antes de seleccionarlo.')).toHaveClass('import-warning')
    expect(screen.getByText('Posible duplicado: se parece a un depósito que ya guardaste. Revísalo antes de guardarlo.')).toHaveClass('import-warning')
    expect(screen.queryAllByText(/^Advertencia:/)).toHaveLength(0)
    expect(screen.getByText('Selecciona al menos una fila que se pueda importar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar 0 gastos y 0 depósitos' })).toBeDisabled()
  })

  it('maps row error, warning, and confirmation codes to Spanish with readable fallbacks', () => {
    const row = {
      ...expenseRow,
      errors: ['date_required', 'brand_new_error'],
      warnings: ['possible_duplicate', 'brand_new_warning'],
      isPossibleDuplicate: true,
    }
    const confirmationIssue = {
      code: 'duplicate_review_required',
      message: 'Se encontraron posibles duplicados nuevos.',
      rows: [{ rowId: 'row-1', codes: ['possible_duplicate', 'category_reserved', 'brand_new_confirmation'] }],
      requiresPreviewRefresh: false,
    }
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([row]), confirmationIssue })} />)

    expect(screen.getByText('Problema: falta la fecha')).toHaveClass('import-error')
    expect(screen.getByText('Problema: brand new error')).toHaveClass('import-error')
    expect(screen.getByText('Advertencia: brand new warning')).toHaveClass('import-warning')
    expect(screen.getByText('Posible duplicado nuevo. Revisa esta fila y vuelve a seleccionarla si quieres importarla.'))
      .toHaveClass('import-warning')
    expect(screen.getByText('Elige una categoría distinta de “Otra”.')).toHaveClass('import-error')
    expect(screen.getByText('Problema: brand new confirmation')).toHaveClass('import-error')
    expect(screen.getByRole('heading', { name: 'Posibles duplicados nuevos por revisar' })).toBeInTheDocument()
  })

  it('titles each confirmation issue in Spanish', () => {
    const titles = {
      preview_expired: 'La vista previa venció',
      preview_unavailable: 'Vista previa no disponible',
      confirmation_failed: 'Importación no confirmada',
    }
    for (const [code, title] of Object.entries(titles)) {
      const { unmount } = render(<ImportPreviewPanel importState={importState({
        confirmationIssue: { code, message: 'Mensaje.', rows: [], requiresPreviewRefresh: false },
      })} />)
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
      unmount()
    }
  })

  it('announces the saving state and refresh-required guidance in Spanish', () => {
    const { rerender } = render(<ImportPreviewPanel importState={importState({ confirming: true })} />)
    expect(screen.getByRole('button', { name: 'Guardando 1 gasto y 0 depósitos…' })).toBeDisabled()

    rerender(<ImportPreviewPanel importState={importState({
      confirmationIssue: { code: 'duplicate_review_required', message: 'Mensaje.', rows: [], requiresPreviewRefresh: true },
    })} />)
    expect(screen.getByText('Actualiza la página para ver la revisión de duplicados más reciente antes de importar.')).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState()} externalLocked />)
    expect(screen.getByText('Termina el depósito que estás editando antes de cambiar el estado de cuenta.')).toBeInTheDocument()
  })

  it('announces one bulk request in Spanish and keeps the uncertain-outcome guidance distinct', async () => {
    const user = userEvent.setup()
    let finish
    const bulkSelection = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const preview = previewWith([expenseRow, { ...expenseRow, rowId: 'row-3', sourceRowOrdinal: 3, selectedForImport: false }])
    const { rerender } = render(<ImportPreviewPanel importState={importState({ preview, bulkSelection })} />)

    await user.click(screen.getByRole('button', { name: /^Borrar selección/ }))
    expect(screen.getByText('Borrando la selección de 1 fila…')).toBeInTheDocument()
    expect(bulkSelection).toHaveBeenCalledWith('clear', ['row-1'])
    await act(async () => { finish({ status: 'done', count: 1, changedRowIds: ['row-1'] }) })
    expect(screen.getByText('Se borró la selección de 1 fila.')).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState({
      preview,
      bulkSelection,
      confirmationIssue: { code: 'selection_uncertain', message: 'Mensaje.', rows: [], requiresPreviewRefresh: true },
    })} />)
    expect(screen.getByText('Actualiza la página para ver lo que está guardado antes de importar.')).toBeInTheDocument()
    expect(screen.queryByText('Actualiza la página para ver la revisión de duplicados más reciente antes de importar.')).not.toBeInTheDocument()
  })

  it('renders the completion summary in Spanish, including already-imported statements', () => {
    const { rerender } = render(<ImportPreviewPanel importState={importState({ preview: null, selectedCount: 0, confirmation: confirmed })} />)
    expect(screen.getByRole('heading', { name: 'Importación completada' })).toBeInTheDocument()
    expect(screen.getByText(/^Guardado el .+: 1 gasto y 1 depósito\.$/)).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState({
      preview: null,
      selectedCount: 0,
      confirmation: { ...confirmed, status: 'already_confirmed', importedExpenseCount: 2, importedInflowCount: 0 },
    })} />)
    expect(screen.getByRole('heading', { name: 'Estado de cuenta ya importado' })).toBeInTheDocument()
    expect(screen.getByText(/^Ya se guardó el .+: 2 gastos y 0 depósitos\.$/)).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState({
      preview: null,
      selectedCount: 0,
      confirmation: { ...confirmed, confirmedAt: 'not a date' },
    })} />)
    expect(screen.getByText('Guardado: 1 gasto y 1 depósito. La hora no está disponible.')).toBeInTheDocument()
  })

  it.each([
    [['expenses'], 'tus gastos en Movimientos. Usa el botón'],
    [['cashIn'], 'tus depósitos en Movimientos. Usa el botón'],
    [['expenses', 'cashIn'], 'tus gastos ni tus depósitos en Movimientos. Usa el botón'],
  ])('maps failed list identifiers %j to a Spanish refresh message', async (failedLists, expected) => {
    const user = userEvent.setup()
    const onImportConfirmed = vi.fn().mockResolvedValue({ failedLists })
    const state = importState({ confirm: vi.fn().mockResolvedValue(confirmed) })
    render(<ImportPreviewPanel importState={state} onImportConfirmed={onImportConfirmed} />)

    await user.click(screen.getByRole('button', { name: 'Guardar 1 gasto y 0 depósitos' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('La importación funcionó, pero no pudimos actualizar')
    expect(alert).toHaveTextContent(expected)
    expect(onImportConfirmed).toHaveBeenCalledWith(confirmed)
  })

  it('shows a Spanish message when the whole Activity refresh fails', async () => {
    const user = userEvent.setup()
    const onImportConfirmed = vi.fn().mockRejectedValue(new Error('offline'))
    const state = importState({ confirm: vi.fn().mockResolvedValue(confirmed) })
    render(<ImportPreviewPanel importState={state} onImportConfirmed={onImportConfirmed} />)

    await user.click(screen.getByRole('button', { name: 'Guardar 1 gasto y 0 depósitos' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Vuelve a cargar esta página para ver tus movimientos importados.')
  })

  it('uses count-aware row totals and keeps the English wording unchanged', async () => {
    const one = render(<ImportPreviewPanel importState={importState()} />)
    expect(screen.getByText(/^1 fila · disponible hasta /)).toBeInTheDocument()
    one.unmount()

    const many = render(<ImportPreviewPanel importState={importState({ preview: previewWith([expenseRow, depositRow]) })} />)
    expect(screen.getByText(/^2 filas · disponible hasta /)).toBeInTheDocument()
    many.unmount()

    await i18n.changeLanguage('en')
    const english = render(<ImportPreviewPanel importState={importState()} />)
    expect(screen.getByText(/^1 rows · available until /)).toBeInTheDocument()
    english.unmount()
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([expenseRow, depositRow]) })} />)
    expect(screen.getByText(/^2 rows · available until /)).toBeInTheDocument()
  })

  it('shows every confirmation-code message in Spanish with the right severity', () => {
    const messages = [
      ['possible_duplicate', 'Posible duplicado nuevo. Revisa esta fila y vuelve a seleccionarla si quieres importarla.', 'import-warning'],
      ['possible_inflow_duplicate', 'Posible duplicado de depósito nuevo. Revisa esta fila y vuelve a seleccionarla si quieres guardarla.', 'import-warning'],
      ['row_not_selectable', 'Esta fila no se puede seleccionar para importar.', 'import-error'],
      ['date_required', 'A esta fila le falta la fecha.', 'import-error'],
      ['amount_must_be_positive', 'El monto debe ser mayor que cero.', 'import-error'],
      ['amount_out_of_range', 'El monto está fuera del rango admitido.', 'import-error'],
      ['amount_precision_invalid', 'El monto puede tener hasta dos decimales.', 'import-error'],
      ['description_required', 'Agrega una descripción para esta fila.', 'import-error'],
      ['description_too_long', 'La descripción es demasiado larga.', 'import-error'],
      ['category_required', 'Elige una categoría para este gasto.', 'import-error'],
      ['category_too_long', 'La categoría es demasiado larga.', 'import-error'],
      ['category_reserved', 'Elige una categoría distinta de “Otra”.', 'import-error'],
    ]
    const confirmationIssue = {
      code: 'confirmation_validation_failed',
      message: 'Mensaje.',
      rows: [{ rowId: 'row-1', codes: messages.map(([code]) => code) }],
      requiresPreviewRefresh: false,
    }
    render(<ImportPreviewPanel importState={importState({ confirmationIssue })} />)

    for (const [, text, severity] of messages) {
      expect(screen.getByText(text)).toHaveClass(severity)
    }
  })

  it('shows the Spanish save-failed messages for a selection change and for a draft save', async () => {
    const user = userEvent.setup()
    render(<ImportPreviewPanel importState={importState({ updateRow: vi.fn().mockResolvedValue(null) })} />)
    const table = screen.getByRole('region', { name: 'Vista previa del estado de cuenta' })
    const context = 'SYNTHETIC CAFE, 12 ago 2026, fila 1 del estado de cuenta'

    await user.click(within(table).getByRole('checkbox', { name: `Seleccionar para importar: ${context}` }))
    expect(await within(table).findByRole('alert')).toHaveTextContent('No pudimos actualizar esta fila. Inténtalo de nuevo.')

    const description = within(table).getByLabelText(`Descripción del gasto: ${context}`)
    await user.clear(description)
    await user.type(description, 'Unsaved coffee')
    expect(within(table).getByRole('status')).toHaveTextContent('Cambios sin guardar')
    await user.click(within(table).getByRole('button', { name: `Guardar fila: ${context}` }))

    expect(await within(table).findByRole('alert')).toHaveTextContent('No pudimos guardar. Tus cambios siguen sin guardarse.')
    expect(description).toHaveValue('Unsaved coffee')
  })

  it('keeps English readable fallbacks for unknown codes', async () => {
    await i18n.changeLanguage('en')
    const row = { ...expenseRow, errors: ['brand_new_error'], warnings: ['brand_new_warning'] }
    const confirmationIssue = {
      code: 'confirmation_validation_failed',
      message: 'Some selected rows need changes before you can import them.',
      rows: [{ rowId: 'row-1', codes: ['brand_new_confirmation'] }],
      requiresPreviewRefresh: false,
    }
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([row]), confirmationIssue })} />)

    expect(screen.getByText('Problem: brand new error')).toBeInTheDocument()
    expect(screen.getByText('Warning: brand new warning')).toBeInTheDocument()
    expect(screen.getByText('Problem: brand new confirmation')).toBeInTheDocument()
  })
  it('formats the row amount in USD with the code in Spanish', () => {
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([{ ...expenseRow, amount: 1234.5 }]) })} />)
    expect(screen.getByText('USD 1,234.50')).toBeInTheDocument()
  })
})
