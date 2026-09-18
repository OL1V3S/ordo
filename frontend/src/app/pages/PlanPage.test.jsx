import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlanPage from './PlanPage'
import { LocaleProvider } from '../../shared/localization/LocaleProvider'
import i18n from '../../shared/localization/i18n'

describe('Plan navigation hub', () => {
  beforeEach(async () => i18n.changeLanguage('en'))
  afterEach(() => vi.unstubAllGlobals())

  it('links to each established planning workflow without fetching data', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<LocaleProvider><MemoryRouter><PlanPage /></MemoryRouter></LocaleProvider>)

    expect(screen.getByRole('heading', { name: 'Plan', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Planning tools' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Budgets/ })).toHaveAttribute('href', '/budgets')
    expect(screen.getByRole('link', { name: /Commitments/ })).toHaveAttribute('href', '/commitments')
    expect(screen.getByRole('link', { name: /Paychecks/ })).toHaveAttribute('href', '/paychecks')
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.queryByText(/monthly category limits/i)).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('renders localized planning labels while preserving destination paths', async () => {
    await i18n.changeLanguage('es')
    render(<LocaleProvider><MemoryRouter><PlanPage /></MemoryRouter></LocaleProvider>)

    expect(screen.getByRole('navigation', { name: 'Herramientas de planificación' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Presupuestos' })).toHaveAttribute('href', '/budgets')
    expect(screen.getByRole('link', { name: 'Compromisos' })).toHaveAttribute('href', '/commitments')
    expect(screen.getByRole('link', { name: 'Pagos de nómina' })).toHaveAttribute('href', '/paychecks')
  })
})
