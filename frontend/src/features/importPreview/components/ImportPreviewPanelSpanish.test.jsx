import { render, screen, within } from '@testing-library/react'
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

    expect(screen.getByText('Importación de estado de cuenta bancario')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Importar estado de cuenta bancario' })).toBeInTheDocument()
    expect(screen.getByText(/Elige el banco y luego carga un PDF con texto extraíble de hasta 10 MiB/)).toBeInTheDocument()
    expect(screen.getByText(/Revisa y guarda cualquier edición antes de confirmar/)).toBeInTheDocument()
    expect(screen.getByLabelText('Banco')).toHaveValue('sunflower_pdf')
    expect(screen.getByRole('option', { name: 'Elige un banco' })).toBeInTheDocument()
    expect(screen.getByLabelText('PDF del estado de cuenta de Sunflower')).toBeInTheDocument()
    expect(screen.getByText('Suelta aquí un PDF de estado de cuenta').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: 'Elegir PDF' })).toBeEnabled()
  })

  it('shows the Spanish hint and processing states', () => {
    const { rerender } = render(<ImportPreviewPanel importState={importState({ preview: null, sourceType: '', selectedCount: 0 })} />)
    expect(screen.getByText('Elige un banco para habilitar la carga de PDF.')).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState({ preview: null, processing: true, selectedCount: 0 })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Procesando el estado de cuenta de forma segura…')
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
    expect(screen.getByText('1 gasto y 0 depósitos entrantes').tagName).toBe('STRONG')
    expect(screen.getByText(/seleccionados para guardar\./)).toBeInTheDocument()
    expect(screen.getByText('Revisa los registros seleccionados y luego guárdalos juntos.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar 1 gasto y 0 depósitos entrantes' })).toBeEnabled()

    const table = screen.getByRole('region', { name: 'Vista previa de la importación del estado de cuenta' })
    expect(within(table).getByText('Filas del estado de cuenta de Sunflower Bank', { selector: 'caption' })).toBeInTheDocument()
    for (const header of ['Transacción', 'Estado', 'Selección', 'Campos del gasto']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    const context = 'SYNTHETIC CAFE, 2026-08-12, fila 1 del estado de cuenta'
    expect(within(table).getByRole('checkbox', { name: `Seleccionar para importar: ${context}` })).toBeChecked()
    expect(within(table).getByLabelText(`Descripción del gasto: ${context}`)).toHaveValue('Coffee')
    expect(within(table).getByLabelText(`Categoría: ${context}`)).toHaveValue('food')
    expect(within(table).getByRole('option', { name: 'Comida' })).toBeInTheDocument()
    expect(within(table).getByRole('option', { name: 'Sin categoría' })).toBeInTheDocument()
    expect(within(table).getByRole('option', { name: 'Otra' })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: `Guardar fila: ${context}` })).toBeDisabled()
    expect(within(table).getByText('Gasto por revisar')).toBeInTheDocument()
    expect(within(table).getByText('Débito')).toBeInTheDocument()
    expect(within(table).getByText('Transacciones electrónicas')).toBeInTheDocument()
    expect(within(table).getAllByText('Detalles del origen').length).toBeGreaterThan(0)

    const deposit = 'SYNTHETIC DEPOSIT, 2026-08-12, fila 2 del estado de cuenta'
    expect(within(table).getByRole('checkbox', { name: `Guardar depósito entrante: ${deposit}` })).not.toBeChecked()
    expect(within(table).getByText('Depósito entrante')).toBeInTheDocument()
    expect(within(table).getByText('Crédito')).toBeInTheDocument()
    expect(within(table).getByText('Depósitos')).toBeInTheDocument()
    expect(within(table).getByText('No editable')).toBeInTheDocument()
    expect(within(table).getByText(/No lo clasifica como ingreso ni como pago de nómina\./)).toBeInTheDocument()
  })

  it('keeps the exact meaning of the duplicate warnings in Spanish', () => {
    const duplicate = { ...expenseRow, isPossibleDuplicate: true, warnings: ['possible_duplicate'], selectedForImport: false }
    const inflowDuplicate = { ...depositRow, isPossibleInflowDuplicate: true, warnings: ['possible_inflow_duplicate'] }
    render(<ImportPreviewPanel importState={importState({
      preview: previewWith([duplicate, inflowDuplicate]),
      selectedCount: 0,
    })} />)

    expect(screen.getByText('Posible duplicado — revisa antes de seleccionar')).toHaveClass('import-warning')
    expect(screen.getByText('Posible duplicado de depósito entrante — revisa antes de guardar')).toHaveClass('import-warning')
    expect(screen.queryAllByText(/^Advertencia:/)).toHaveLength(0)
    expect(screen.getByText('Selecciona al menos una fila elegible para importar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar 0 gastos y 0 depósitos entrantes' })).toBeDisabled()
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
    expect(screen.getByText('Nuevo posible duplicado — revisa esta fila y vuelve a seleccionarla de forma explícita si debe importarse.'))
      .toHaveClass('import-warning')
    expect(screen.getByText('Elige una categoría distinta de “Otra”.')).toHaveClass('import-error')
    expect(screen.getByText('Problema: brand new confirmation')).toHaveClass('import-error')
    expect(screen.getByRole('heading', { name: 'Revisa las nuevas advertencias de duplicados' })).toBeInTheDocument()
  })

  it('titles each confirmation issue in Spanish', () => {
    const titles = {
      preview_expired: 'La vista previa venció',
      preview_unavailable: 'Vista previa no disponible',
      confirmation_failed: 'El estado de cuenta no se confirmó',
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
    expect(screen.getByRole('button', { name: 'Guardando 1 gasto y 0 depósitos entrantes…' })).toBeDisabled()

    rerender(<ImportPreviewPanel importState={importState({
      confirmationIssue: { code: 'duplicate_review_required', message: 'Mensaje.', rows: [], requiresPreviewRefresh: true },
    })} />)
    expect(screen.getByText('Actualiza esta página para cargar la revisión de duplicados vigente antes de confirmar.')).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState()} externalLocked />)
    expect(screen.getByText('Termina la tarea de entrada de dinero antes de cambiar el estado de cuenta.')).toBeInTheDocument()
  })

  it('renders the completion summary in Spanish, including already-imported statements', () => {
    const { rerender } = render(<ImportPreviewPanel importState={importState({ preview: null, selectedCount: 0, confirmation: confirmed })} />)
    expect(screen.getByRole('heading', { name: 'Importación completada' })).toBeInTheDocument()
    expect(screen.getByText(/^Se guardaron 1 gasto y 1 depósito entrante el /)).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState({
      preview: null,
      selectedCount: 0,
      confirmation: { ...confirmed, status: 'already_confirmed', importedExpenseCount: 2, importedInflowCount: 0 },
    })} />)
    expect(screen.getByRole('heading', { name: 'Estado de cuenta ya importado' })).toBeInTheDocument()
    expect(screen.getByText(/^Ya se habían guardado 2 gastos y 0 depósitos entrantes el /)).toBeInTheDocument()

    rerender(<ImportPreviewPanel importState={importState({
      preview: null,
      selectedCount: 0,
      confirmation: { ...confirmed, confirmedAt: 'not a date' },
    })} />)
    expect(screen.getByText('Se guardaron 1 gasto y 1 depósito entrante en un momento no disponible.')).toBeInTheDocument()
  })

  it.each([
    [['expenses'], 'actividad de gastos. Usa'],
    [['cashIn'], 'actividad de entradas de dinero. Usa'],
    [['expenses', 'cashIn'], 'actividad de gastos ni de entradas de dinero. Usa'],
  ])('maps failed list identifiers %j to a Spanish refresh message', async (failedLists, expected) => {
    const user = userEvent.setup()
    const onImportConfirmed = vi.fn().mockResolvedValue({ failedLists })
    const state = importState({ confirm: vi.fn().mockResolvedValue(confirmed) })
    render(<ImportPreviewPanel importState={state} onImportConfirmed={onImportConfirmed} />)

    await user.click(screen.getByRole('button', { name: 'Guardar 1 gasto y 0 depósitos entrantes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('La importación se realizó correctamente, pero no se pudo actualizar la')
    expect(alert).toHaveTextContent(expected)
    expect(onImportConfirmed).toHaveBeenCalledWith(confirmed)
  })

  it('shows a Spanish message when the whole Activity refresh fails', async () => {
    const user = userEvent.setup()
    const onImportConfirmed = vi.fn().mockRejectedValue(new Error('offline'))
    const state = importState({ confirm: vi.fn().mockResolvedValue(confirmed) })
    render(<ImportPreviewPanel importState={state} onImportConfirmed={onImportConfirmed} />)

    await user.click(screen.getByRole('button', { name: 'Guardar 1 gasto y 0 depósitos entrantes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Vuelve a cargar esta página para ver los registros importados.')
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
      ['possible_duplicate', 'Nuevo posible duplicado — revisa esta fila y vuelve a seleccionarla de forma explícita si debe importarse.', 'import-warning'],
      ['possible_inflow_duplicate', 'Nuevo posible duplicado de depósito entrante — revisa esta fila y vuelve a seleccionarla de forma explícita si debe guardarse.', 'import-warning'],
      ['row_not_selectable', 'Esta fila no es elegible para la selección de importación solicitada.', 'import-error'],
      ['date_required', 'Se requiere una fecha de transacción.', 'import-error'],
      ['amount_must_be_positive', 'El monto del gasto debe ser positivo.', 'import-error'],
      ['amount_out_of_range', 'El monto del gasto está fuera del rango admitido.', 'import-error'],
      ['amount_precision_invalid', 'El monto del gasto debe tener como máximo dos decimales.', 'import-error'],
      ['description_required', 'Se requiere una descripción.', 'import-error'],
      ['description_too_long', 'La descripción es demasiado larga.', 'import-error'],
      ['category_required', 'Se requiere una categoría de gasto.', 'import-error'],
      ['category_too_long', 'La categoría de gasto es demasiado larga.', 'import-error'],
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
    const table = screen.getByRole('region', { name: 'Vista previa de la importación del estado de cuenta' })
    const context = 'SYNTHETIC CAFE, 2026-08-12, fila 1 del estado de cuenta'

    await user.click(within(table).getByRole('checkbox', { name: `Seleccionar para importar: ${context}` }))
    expect(await within(table).findByRole('alert')).toHaveTextContent('No se pudo actualizar la fila. Inténtalo de nuevo.')

    const description = within(table).getByLabelText(`Descripción del gasto: ${context}`)
    await user.clear(description)
    await user.type(description, 'Unsaved coffee')
    expect(within(table).getByRole('status')).toHaveTextContent('Cambios sin guardar')
    await user.click(within(table).getByRole('button', { name: `Guardar fila: ${context}` }))

    expect(await within(table).findByRole('alert')).toHaveTextContent('No se pudo guardar. Los cambios siguen sin guardarse.')
    expect(description).toHaveValue('Unsaved coffee')
  })

  it('keeps English readable fallbacks for unknown codes', async () => {
    await i18n.changeLanguage('en')
    const row = { ...expenseRow, errors: ['brand_new_error'], warnings: ['brand_new_warning'] }
    const confirmationIssue = {
      code: 'confirmation_validation_failed',
      message: 'One or more selected rows need attention before the import can be confirmed.',
      rows: [{ rowId: 'row-1', codes: ['brand_new_confirmation'] }],
      requiresPreviewRefresh: false,
    }
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([row]), confirmationIssue })} />)

    expect(screen.getByText('Issue: brand new error')).toBeInTheDocument()
    expect(screen.getByText('Warning: brand new warning')).toBeInTheDocument()
    expect(screen.getByText('Issue: brand new confirmation')).toBeInTheDocument()
  })
  it('formats the row amount in USD with the code in Spanish', () => {
    render(<ImportPreviewPanel importState={importState({ preview: previewWith([{ ...expenseRow, amount: 1234.5 }]) })} />)
    expect(screen.getByText('USD 1,234.50')).toBeInTheDocument()
  })
})
