import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BudgetsPage from './BudgetsPage'
import i18n, { resources } from '../../../shared/localization/i18n'
import { useExpenses } from '../../expenses/hooks/useExpenses'
import { useBudgetLimits } from '../hooks/useBudgetLimits'
import { chooseRowAction, openRowActions } from '../../../test/rowActions'

vi.mock('../../expenses/hooks/useExpenses', () => ({ useExpenses: vi.fn() }))
vi.mock('../hooks/useBudgetLimits', () => ({ useBudgetLimits: vi.fn() }))

const limits = [
  { id: 1, category: 'food', limitAmount: 100 },
  { id: 2, category: 'bills', limitAmount: 100 },
  { id: 3, category: 'zero', limitAmount: 0 },
]

describe('Budgets page in Spanish', () => {
  const upsertLimit = vi.fn()
  const deleteLimit = vi.fn()
  const refreshLimits = vi.fn()
  const refreshSpending = vi.fn()

  function setLimits(overrides = {}) {
    useBudgetLimits.mockReturnValue({
      budgetLimits: [], loading: false, error: null, refresh: refreshLimits, upsertLimit, deleteLimit, ...overrides,
    })
  }
  function setSpending(overrides = {}) {
    useExpenses.mockReturnValue({
      expenses: [
        { category: 'food', amount: 95, date: '2026-08-02' },
        { category: 'bills', amount: 125, date: '2026-08-03' },
      ],
      loading: false, error: null, refresh: refreshSpending, ...overrides,
    })
  }

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 14, 12, 0, 0))
    refreshLimits.mockResolvedValue(undefined)
    refreshSpending.mockResolvedValue(undefined)
    upsertLimit.mockResolvedValue({ refreshFailed: false })
    deleteLimit.mockResolvedValue({ refreshFailed: false })
    setLimits()
    setSpending()
    await i18n.changeLanguage('es')
  })

  afterEach(async () => {
    vi.useRealTimers()
    await i18n.changeLanguage('en')
  })

  it('renders the page, toolbar, empty state, and reset explanation in Spanish', () => {
    render(<BudgetsPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Presupuestos' })).toBeInTheDocument()
    expect(screen.getByText('Mira cómo se compara tu gasto con el límite de cada categoría.')).toBeInTheDocument()
    expect(screen.getByLabelText('Mes del presupuesto')).toHaveValue('2026-08')
    expect(screen.getByRole('button', { name: 'Agregar presupuesto por categoría' })).toBeEnabled()
    expect(screen.getByRole('heading', { level: 2, name: 'Presupuestos por categoría' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actualizar límites' })).toBeEnabled()
    expect(screen.getByText('No hay límites de presupuesto definidos para este mes.')).toBeInTheDocument()
    expect(screen.getByText('Acerca de los límites mensuales').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(`Próximo reinicio: 1 sep 2026. Cada límite se aplica a su mes calendario seleccionado.`)).toBeInTheDocument()
    expect(screen.getByText('Un límite de cero es un presupuesto intencional sin gastos. Es diferente a no tener un presupuesto para una categoría.')).toBeInTheDocument()
  })

  it('keeps the limit distinct from recorded spending on each card and keeps stored category names and money as-is', async () => {
    const user = userEvent.setup()
    setLimits({ budgetLimits: limits })
    render(<BudgetsPage />)

    const food = screen.getByRole('listitem', { name: 'Presupuesto de Food' })
    expect(within(food).getByText('Cerca del límite')).toBeVisible()
    expect(within(food).getByText('USD 95.00')).toBeVisible()
    expect(within(food).getByText('usado de USD 100.00')).toBeVisible()
    expect(within(food).getByText('95% usado')).toBeVisible()
    expect(within(food).getByRole('progressbar', { name: 'Uso del presupuesto de Food' })).toHaveAttribute('aria-valuetext', 'USD\u00a095.00 usado de USD\u00a0100.00, 95%')
    await openRowActions(user, 'Food')
    expect(within(food).getByRole('button', { name: 'Editar presupuesto de Food' })).toHaveTextContent('Editar')
    expect(within(food).getByRole('button', { name: 'Eliminar presupuesto de Food' })).toHaveTextContent('Eliminar')

    const bills = screen.getByRole('listitem', { name: 'Presupuesto de Bills' })
    expect(within(bills).getByText('Por encima del límite')).toBeVisible()
    expect(within(bills).getByText('125% usado')).toBeVisible()
    expect(within(bills).getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'USD\u00a0125.00 usado de USD\u00a0100.00, 125%')

    const zero = screen.getByRole('listitem', { name: 'Presupuesto de Zero' })
    expect(within(zero).getByText('Límite de cero')).toBeVisible()
    expect(within(zero).getByText('No hay porcentaje para un límite de cero.')).toBeVisible()
    expect(within(zero).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(zero).toHaveClass('budget-row--warning')
  })

  it('localizes the add form, option labels, validation, and success feedback without changing the payload', async () => {
    const user = userEvent.setup()
    render(<BudgetsPage />)
    await user.click(screen.getByRole('button', { name: 'Agregar presupuesto por categoría' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Agregar presupuesto por categoría' })).toBeInTheDocument()
    expect(screen.getByText('Para 2026-08')).toBeInTheDocument()
    expect(screen.getByText('Termina o cancela este presupuesto de 2026-08 antes de cambiar de mes.')).toBeInTheDocument()
    expect(screen.getByText('Detalles del presupuesto')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar límite' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Elige una categoría e ingresa un monto límite.')
    expect(screen.getByLabelText('Categoría')).toHaveFocus()
    expect(upsertLimit).not.toHaveBeenCalled()

    const options = within(screen.getByLabelText('Categoría')).getAllByRole('option').map((option) => [option.value, option.textContent])
    expect(options).toEqual([
      ['', 'Categoría'], ['food', 'Comida'], ['transport', 'Transporte'], ['bills', 'Facturas'],
      ['entertainment', 'Entretenimiento'], ['other', 'Otra'],
    ])
    await user.selectOptions(screen.getByLabelText('Categoría'), 'other')
    await user.type(screen.getByLabelText('Categoría personalizada'), 'Home Repair')
    expect(screen.getByPlaceholderText('Categoría personalizada')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Monto límite'), '75.25')
    await user.click(screen.getByRole('button', { name: 'Guardar límite' }))

    expect(upsertLimit).toHaveBeenCalledWith({
      category: 'home repair',
      limitAmount: 75.25,
      monthYear: new Date('2026-08-01T00:00:00').toISOString(),
    })
    expect(screen.getByRole('status')).toHaveTextContent('Límite de presupuesto guardado.')
  })

  it('localizes edit labels, the delete confirmation, and the saved and deleted outcomes', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    setLimits({ budgetLimits: limits })
    render(<BudgetsPage />)

    await chooseRowAction(user, 'Editar presupuesto de Food')
    expect(screen.getByRole('heading', { level: 2, name: 'Editar presupuesto de Food' })).toBeInTheDocument()
    expect(screen.getByLabelText('Monto límite de Food')).toHaveValue('100.00')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await chooseRowAction(user, 'Eliminar presupuesto de Food')
    expect(confirm).toHaveBeenCalledWith('¿Eliminar el límite de presupuesto de la categoría "Food"?')
    expect(deleteLimit).toHaveBeenCalledWith(1)
    expect(screen.getByRole('status')).toHaveTextContent('Límite de presupuesto eliminado.')
  })

  it('reports a completed write with a failed refresh separately and an unknown outcome as unconfirmed', async () => {
    const user = userEvent.setup()
    setLimits({ budgetLimits: limits })
    upsertLimit.mockResolvedValueOnce({ refreshFailed: true })
    render(<BudgetsPage />)

    await chooseRowAction(user, 'Editar presupuesto de Food')
    await user.click(screen.getByRole('button', { name: 'Guardar límite' }))
    expect(screen.getByRole('status')).toHaveTextContent('Límite de presupuesto guardado. No se pudieron actualizar los límites de presupuesto. Actualiza los límites antes de hacer otro cambio.')

    await user.click(screen.getByRole('button', { name: 'Actualizar límites' }))
    expect(screen.getByRole('status')).toHaveTextContent('Límites de presupuesto actualizados. Revisa los límites guardados antes de volver a intentar tu cambio.')

    upsertLimit.mockRejectedValueOnce(new Error('offline'))
    await chooseRowAction(user, 'Editar presupuesto de Food')
    await user.click(screen.getByRole('button', { name: 'Guardar límite' }))
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos confirmar el cambio. Actualiza los límites y revisa los presupuestos guardados antes de intentarlo de nuevo.')
    expect(screen.getByRole('button', { name: 'Guardar límite' })).toBeDisabled()
  })

  it('reports a completed delete with a failed refresh separately', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    setLimits({ budgetLimits: limits })
    deleteLimit.mockResolvedValueOnce({ refreshFailed: true })
    render(<BudgetsPage />)

    await chooseRowAction(user, 'Eliminar presupuesto de Food')
    expect(deleteLimit).toHaveBeenCalledWith(1)
    expect(screen.getByRole('status')).toHaveTextContent('Límite de presupuesto eliminado. No se pudieron actualizar los límites de presupuesto. Actualiza los límites antes de hacer otro cambio.')
  })

  it('names the remaining budget statuses and the unavailable comparison note in Spanish', () => {
    setLimits({
      budgetLimits: [
        { id: 11, category: 'within', limitAmount: 100 },
        { id: 12, category: 'exact', limitAmount: 100 },
        { id: 13, category: 'review', limitAmount: 100 },
        { id: 14, category: 'unsafe', limitAmount: Number('9999999999999999') },
      ],
    })
    setSpending({
      expenses: [
        { category: 'within', amount: 50, date: '2026-08-02' },
        { category: 'exact', amount: 100, date: '2026-08-03' },
        { category: 'review', amount: 'not money', date: '2026-08-04' },
        { category: 'unsafe', amount: 5, date: '2026-08-05' },
      ],
    })
    render(<BudgetsPage />)
    const note = 'La comparación exacta no está disponible. Revisa el monto antes de confiar en el estado de este presupuesto.'

    const within_ = screen.getByRole('listitem', { name: 'Presupuesto de Within' })
    expect(within(within_).getByText('Dentro del límite')).toBeVisible()
    expect(within_).not.toHaveTextContent('La comparación exacta no está disponible')

    const exact = screen.getByRole('listitem', { name: 'Presupuesto de Exact' })
    expect(within(exact).getByText('Límite alcanzado')).toBeVisible()

    const review = screen.getByRole('listitem', { name: 'Presupuesto de Review' })
    expect(within(review).getByText('El gasto requiere revisión')).toBeVisible()
    expect(within(review).getByText(note)).toBeVisible()
    expect(within(review).queryByRole('progressbar')).not.toBeInTheDocument()

    const unsafe = screen.getByRole('listitem', { name: 'Presupuesto de Unsafe' })
    expect(within(unsafe).getByText('El límite requiere revisión')).toBeVisible()
    expect(within(unsafe).getByText(note)).toBeVisible()
    expect(within(unsafe).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows localized loading, error, and unavailable states without rendering zero spending', async () => {
    const user = userEvent.setup()
    setLimits({ budgetLimits: limits })
    setSpending({ error: new Error('offline') })
    const { rerender } = render(<BudgetsPage />)
    expect(screen.getByText('No pudimos cargar los gastos registrados. Los montos usados y el progreso no están disponibles.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar gastos' }))
    expect(refreshSpending).toHaveBeenCalledOnce()
    for (const card of within(screen.getByRole('list', { name: 'Presupuestos por categoría' })).getAllByRole('listitem')) {
      expect(within(card).getAllByText('No disponible').length).toBeGreaterThan(0)
      expect(within(card).getByText('Gasto no disponible')).toBeVisible()
    }
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    setSpending({ loading: true })
    rerender(<BudgetsPage />)
    expect(screen.getByText('Cargando gastos registrados...')).toBeInTheDocument()

    setSpending()
    setLimits({ loading: true })
    rerender(<BudgetsPage />)
    expect(screen.getByText('Cargando límites de presupuesto...')).toBeInTheDocument()

    setLimits({ error: new Error('offline') })
    rerender(<BudgetsPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar los límites de presupuesto de 2026-08. Actualiza los límites para intentarlo de nuevo.')
  })

  it('resolves feedback when rendered so it follows a language change', async () => {
    const user = userEvent.setup()
    render(<BudgetsPage />)
    await user.click(screen.getByRole('button', { name: 'Agregar presupuesto por categoría' }))
    await user.selectOptions(screen.getByLabelText('Categoría'), 'food')
    await user.type(screen.getByLabelText('Monto límite'), '10')
    await user.click(screen.getByRole('button', { name: 'Guardar límite' }))
    expect(screen.getByRole('status')).toHaveTextContent('Límite de presupuesto guardado.')

    await act(async () => { await i18n.changeLanguage('en') })
    expect(screen.getByRole('status')).toHaveTextContent('Budget limit saved.')
  })
})

describe('budgets catalog', () => {
  const placeholders = (value, path = '') => typeof value === 'string'
    ? { [path]: (value.match(/{{\s*\w+\s*}}/g) ?? []).sort() }
    : Object.assign({}, ...Object.keys(value).map((key) => placeholders(value[key], path ? `${path}.${key}` : key)))

  it('keeps interpolation placeholders identical between English and Spanish', () => {
    expect(placeholders(resources.es.budgets)).toEqual(placeholders(resources.en.budgets))
  })
})
