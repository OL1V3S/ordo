import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import client from '../shared/api/client'
import { PlanSwitcher } from './PlanLayout'
import { LocaleProvider } from '../shared/localization/LocaleProvider'
import i18n from '../shared/localization/i18n'

function renderAt(path) {
  return render(<LocaleProvider><MemoryRouter initialEntries={[path]}><PlanSwitcher /></MemoryRouter></LocaleProvider>)
}

describe('Plan switcher', () => {
  beforeEach(async () => i18n.changeLanguage('en'))
  afterEach(() => vi.unstubAllGlobals())

  it('lists the three planning pages in order with their addresses', () => {
    renderAt('/budgets')
    expect(screen.getByRole('navigation', { name: 'Planning tools' })).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Budgets', '/budgets'], ['Commitments', '/commitments'], ['Paychecks', '/paychecks'],
    ])
  })

  it.each([
    ['/budgets', 'Budgets'],
    ['/commitments', 'Commitments'],
    ['/paychecks', 'Paychecks'],
    ['/paychecks/', 'Paychecks'],
    ['/paychecks/?source=bookmark', 'Paychecks'],
    ['/plan', 'Budgets'],
  ])('marks exactly one current link for %s', (path, label) => {
    renderAt(path)
    const current = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'))
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent(label)
    expect(current[0]).toHaveAttribute('aria-current', 'page')
    const styled = screen.getAllByRole('link').filter((link) => link.classList.contains('plan-switcher__link--current'))
    expect(styled).toEqual(current)
  })

  it('renders Spanish labels while preserving addresses', async () => {
    await i18n.changeLanguage('es')
    renderAt('/commitments')
    expect(screen.getByRole('navigation', { name: 'Herramientas de planificación' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Presupuestos' })).toHaveAttribute('href', '/budgets')
    expect(screen.getByRole('link', { name: 'Compromisos' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Pagos de nómina' })).toHaveAttribute('href', '/paychecks')
  })

  it('fetches no data', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const adapter = vi.fn()
    const original = client.defaults.adapter
    client.defaults.adapter = adapter
    renderAt('/plan')
    client.defaults.adapter = original
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(adapter).not.toHaveBeenCalled()
  })
})
